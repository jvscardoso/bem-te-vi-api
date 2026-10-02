import {
  cleanupTenants,
  createPatient,
  createTestApp,
  createUser,
  permissionIds,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
  type TestUser,
} from './helpers/e2e.js';

// appointments:read/write valem para a própria agenda; appointments:all estende as duas à agenda
// de todos os profissionais. Cenário: o dono (médico, Admin) vê tudo; um médico recém-cadastrado
// só vê e mexe nos agendamentos em que ele é o profissional.
// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Agenda: escopo própria agenda × todas (e2e)', () => {
  let ctx: TestApp;
  let owner: TestTenant;
  let doctor: TestUser;
  let colleague: TestUser;
  let patient: { id: string };
  let ownAppointmentId: string;
  let colleagueAppointmentId: string;

  const url = (suffix = '') => `/tenants/${owner.tenantId}/appointments${suffix}`;
  const schedule = (as: TestUser, professionalId: string, scheduledAt: string) =>
    ctx.http().post(url()).set(as.auth).send({ patientId: patient.id, professionalId, scheduledAt });

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await signupTenant(ctx.http, 'scope');
    patient = await createPatient(ctx.http, owner);

    const ids = await permissionIds(ctx.prisma, ['appointments:read', 'appointments:write', 'patients:read']);
    const role = await ctx
      .http()
      .post(`/tenants/${owner.tenantId}/roles`)
      .set(owner.auth)
      .send({ name: `Médico ${uniq()}`, permissionIds: ids })
      .expect(201);
    doctor = await createUser(ctx.http, owner, 'medico', { roleId: role.body.id });
    colleague = await createUser(ctx.http, owner, 'colega', { roleId: role.body.id });

    ownAppointmentId = (await schedule(owner, doctor.id, '2031-05-05T13:00:00.000Z').expect(201)).body.id;
    colleagueAppointmentId = (await schedule(owner, colleague.id, '2031-05-05T13:00:00.000Z').expect(201)).body.id;
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [owner?.tenantId]);
    await ctx.app.close();
  });

  it('a clínica nova já nasce com appointments:all no papel Admin do dono', async () => {
    const me = await ctx.http().get('/auth/me').set(owner.auth).expect(200);
    expect(me.body.permissions).toContain('appointments:all');
  });

  describe('dono (appointments:all)', () => {
    it('vê a agenda de todos e pode filtrar por qualquer profissional', async () => {
      const all = await ctx.http().get(url()).set(owner.auth).expect(200);
      expect(all.body.data.map((a: { id: string }) => a.id)).toEqual(
        expect.arrayContaining([ownAppointmentId, colleagueAppointmentId]),
      );

      const filtered = await ctx.http().get(url()).query({ professionalId: colleague.id }).set(owner.auth).expect(200);
      expect(filtered.body.data.map((a: { id: string }) => a.id)).toEqual([colleagueAppointmentId]);
    });

    it('lista todos os profissionais para agendar', async () => {
      const res = await ctx.http().get(`/tenants/${owner.tenantId}/professionals`).set(owner.auth).expect(200);
      expect(res.body.map((p: { id: string }) => p.id)).toEqual(
        expect.arrayContaining([owner.id, doctor.id, colleague.id]),
      );
    });
  });

  describe('médico novo (sem appointments:all)', () => {
    it('a listagem traz só a própria agenda, com total coerente', async () => {
      const res = await ctx.http().get(url()).set(doctor.auth).expect(200);
      expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([ownAppointmentId]);
      expect(res.body.meta.total).toBe(1);

      // Filtrar por paciente também fica restrito à própria agenda.
      const byPatient = await ctx.http().get(url()).query({ patientId: patient.id }).set(doctor.auth).expect(200);
      expect(byPatient.body.data.map((a: { id: string }) => a.id)).toEqual([ownAppointmentId]);
    });

    it('pedir a agenda de um colega é 403; a própria, explicitamente, é 200', async () => {
      const res = await ctx.http().get(url()).query({ professionalId: colleague.id }).set(doctor.auth).expect(403);
      expect(res.body.message).toContain('appointments:all');
      await ctx.http().get(url()).query({ professionalId: doctor.id }).set(doctor.auth).expect(200);
    });

    it('agendamento de um colega responde 404 em detalhe, edição e cancelamento', async () => {
      await ctx.http().get(url(`/${colleagueAppointmentId}`)).set(doctor.auth).expect(404);
      await ctx.http().patch(url(`/${colleagueAppointmentId}`)).set(doctor.auth).send({ notes: 'x' }).expect(404);
      await ctx.http().delete(url(`/${colleagueAppointmentId}`)).set(doctor.auth).expect(404);

      const intact = await ctx.http().get(url(`/${colleagueAppointmentId}`)).set(owner.auth).expect(200);
      expect(intact.body).toMatchObject({ status: 'scheduled', notes: null });
    });

    it('cria, edita e cancela na própria agenda', async () => {
      const created = await schedule(doctor, doctor.id, '2031-05-06T13:00:00.000Z').expect(201);
      await ctx.http().patch(url(`/${created.body.id}`)).set(doctor.auth).send({ notes: 'retorno' }).expect(200);
      await ctx.http().delete(url(`/${created.body.id}`)).set(doctor.auth).expect(200);
      const res = await ctx.http().get(url(`/${created.body.id}`)).set(doctor.auth).expect(200);
      expect(res.body).toMatchObject({ status: 'cancelled', notes: 'retorno' });
    });

    it('não cria na agenda de um colega nem passa um agendamento próprio para ele (403)', async () => {
      await schedule(doctor, colleague.id, '2031-05-07T13:00:00.000Z').expect(403);
      await ctx
        .http()
        .patch(url(`/${ownAppointmentId}`))
        .set(doctor.auth)
        .send({ professionalId: colleague.id })
        .expect(403);

      const unchanged = await ctx.http().get(url(`/${ownAppointmentId}`)).set(doctor.auth).expect(200);
      expect(unchanged.body.professionalId).toBe(doctor.id);
    });

    it('a lista de profissionais traz só ele mesmo', async () => {
      const res = await ctx.http().get(`/tenants/${owner.tenantId}/professionals`).set(doctor.auth).expect(200);
      expect(res.body.map((p: { id: string }) => p.id)).toEqual([doctor.id]);
    });

    it('passa a ver todas as agendas assim que o papel recebe appointments:all', async () => {
      const ids = await permissionIds(ctx.prisma, ['appointments:read', 'appointments:write', 'appointments:all', 'patients:read']);
      const me = await ctx.http().get('/auth/me').set(doctor.auth).expect(200);
      await ctx.http().patch(`/tenants/${owner.tenantId}/roles/${me.body.roleId}`).set(owner.auth).send({ permissionIds: ids }).expect(200);

      // Sem novo login: as permissões são relidas a cada request.
      await ctx.http().get(url(`/${colleagueAppointmentId}`)).set(doctor.auth).expect(200);
    });
  });
});
