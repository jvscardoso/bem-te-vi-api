import {
  cleanupTenants,
  createPatient,
  createPlatformAdmin,
  createTestApp,
  createUser,
  permissionIds,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
  type TestUser,
} from './helpers/e2e.js';

// Recursos que existem para o frontend não precisar de chamadas extras nem de permissões
// além das da própria tela: catálogo de permissões, lista de profissionais, /auth/me completo
// e nomes relacionados nas respostas de agenda e financeiro.
// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Suporte ao frontend (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;
  let platform: TestTenant;
  // Recepção: agenda + leitura de pacientes, sem users:manage nem tenant:manage.
  let reception: TestUser;
  let professional: TestUser;
  let patient: { id: string; fullName: string };

  const appointmentsUrl = (t: TestTenant, suffix = '') => `/tenants/${t.tenantId}/appointments${suffix}`;
  const chargesUrl = (t: TestTenant, suffix = '') => `/tenants/${t.tenantId}/charges${suffix}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'front-a');
    b = await signupTenant(ctx.http, 'front-b');
    platform = await createPlatformAdmin(ctx);

    const ids = await permissionIds(ctx.prisma, ['appointments:read', 'appointments:write', 'patients:read']);
    const role = await ctx
      .http()
      .post(`/tenants/${a.tenantId}/roles`)
      .set(a.auth)
      .send({ name: `Recepção ${uniq()}`, permissionIds: ids })
      .expect(201);
    reception = await createUser(ctx.http, a, 'Recepcao', { roleId: role.body.id });
    professional = await createUser(ctx.http, a, 'Ana', { defaultAppointmentDurationMinutes: 50 });
    patient = await createPatient(ctx.http, a, { fullName: 'Maria Paciente' });
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId, platform?.tenantId]);
    await ctx.app.close();
  });

  describe('GET /permissions', () => {
    it('lista o catálogo com id, key e description, sem as platform:* para uma clínica', async () => {
      const res = await ctx.http().get('/permissions').set(a.auth).expect(200);
      const keys = res.body.map((p: { key: string }) => p.key);

      expect(keys).toEqual(expect.arrayContaining(['patients:read', 'roles:manage', 'billing:write']));
      expect(keys).not.toContain('platform:manage');
      expect(res.body[0]).toEqual({ id: expect.any(String), key: expect.any(String), description: expect.anything() });
    });

    it('os ids servem direto em permissionIds de um papel', async () => {
      const catalog = (await ctx.http().get('/permissions').set(a.auth).expect(200)).body as { id: string; key: string }[];
      const id = catalog.find((p) => p.key === 'patients:read')!.id;
      await ctx
        .http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(a.auth)
        .send({ name: `Do catálogo ${uniq()}`, permissionIds: [id] })
        .expect(201);
    });

    it('quem tem platform:* vê as platform:*', async () => {
      const res = await ctx.http().get('/permissions').set(platform.auth).expect(403);
      // O admin de plataforma não tem roles:manage: a rota continua exigindo-a.
      expect(res.body.message).toContain('roles:manage');

      const [rolesManage] = await permissionIds(ctx.prisma, ['roles:manage']);
      await ctx.prisma.rolePermission.create({ data: { roleId: platform.roleId, permissionId: rolesManage } });
      const keys = (await ctx.http().get('/permissions').set(platform.auth).expect(200)).body.map(
        (p: { key: string }) => p.key,
      );
      expect(keys).toContain('platform:manage');
    });

    it('exige roles:manage (403) e autenticação (401)', async () => {
      await ctx.http().get('/permissions').set(reception.auth).expect(403);
      await ctx.http().get('/permissions').expect(401);
    });
  });

  describe('GET /tenants/:tenantId/professionals', () => {
    it('quem só tem acesso à agenda lista os profissionais ativos, com a duração efetiva', async () => {
      const res = await ctx.http().get(`/tenants/${a.tenantId}/professionals`).set(reception.auth).expect(200);

      const ana = res.body.find((p: { id: string }) => p.id === professional.id);
      expect(ana).toEqual({
        id: professional.id,
        name: 'Ana',
        defaultAppointmentDurationMinutes: 50,
        effectiveAppointmentDurationMinutes: 50,
      });
      // Sem duração própria, vale a da clínica (30 por padrão).
      const owner = res.body.find((p: { id: string }) => p.id === a.id);
      expect(owner).toMatchObject({ defaultAppointmentDurationMinutes: null, effectiveAppointmentDurationMinutes: 30 });
      // Só campos mínimos: nada de email/status/papel.
      expect(Object.keys(ana).sort()).toEqual(
        ['defaultAppointmentDurationMinutes', 'effectiveAppointmentDurationMinutes', 'id', 'name'].sort(),
      );
    });

    it('não inclui usuários desativados (não podem receber agendamentos)', async () => {
      const disabled = await createUser(ctx.http, a, 'Desativado');
      await ctx.http().patch(`/tenants/${a.tenantId}/users/${disabled.id}`).set(a.auth).send({ status: 'disabled' }).expect(200);

      const res = await ctx.http().get(`/tenants/${a.tenantId}/professionals`).set(a.auth).expect(200);
      expect(res.body.map((p: { id: string }) => p.id)).not.toContain(disabled.id);
    });

    it('exige appointments:read (403) e isola tenants (403)', async () => {
      const [billingRead] = await permissionIds(ctx.prisma, ['billing:read']);
      const role = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(a.auth)
        .send({ name: `Financeiro ${uniq()}`, permissionIds: [billingRead] })
        .expect(201);
      const finance = await createUser(ctx.http, a, 'financeiro', { roleId: role.body.id });

      await ctx.http().get(`/tenants/${a.tenantId}/professionals`).set(finance.auth).expect(403);
      await ctx.http().get(`/tenants/${b.tenantId}/professionals`).set(a.auth).expect(403);
    });
  });

  describe('GET /auth/me', () => {
    it('traz nome, email e papel além das permissões', async () => {
      const res = await ctx.http().get('/auth/me').set(reception.auth).expect(200);
      expect(res.body).toMatchObject({
        userId: reception.id,
        tenantId: a.tenantId,
        name: 'Recepcao',
        email: reception.email.toLowerCase(),
        role: { id: expect.any(String), name: expect.stringContaining('Recepção') },
      });
      expect(res.body.role.id).toBe(res.body.roleId);
      expect(res.body.permissions.sort()).toEqual(['appointments:read', 'appointments:write', 'patients:read']);
    });
  });

  describe('nomes relacionados na agenda', () => {
    it('create, list, get e patch trazem patient { id, fullName } e professional { id, name }', async () => {
      const expected = {
        patient: { id: patient.id, fullName: 'Maria Paciente' },
        professional: { id: professional.id, name: 'Ana' },
      };
      const created = await ctx
        .http()
        .post(appointmentsUrl(a))
        .set(reception.auth)
        .send({ patientId: patient.id, professionalId: professional.id, scheduledAt: '2031-03-10T13:00:00.000Z' })
        .expect(201);
      expect(created.body).toMatchObject(expected);

      const list = await ctx
        .http()
        .get(appointmentsUrl(a))
        .query({ patientId: patient.id })
        .set(reception.auth)
        .expect(200);
      expect(list.body.data[0]).toMatchObject(expected);

      const one = await ctx.http().get(appointmentsUrl(a, `/${created.body.id}`)).set(reception.auth).expect(200);
      expect(one.body).toMatchObject(expected);

      // Com e sem reserva de horário (a atualização segue caminhos diferentes).
      const moved = await ctx
        .http()
        .patch(appointmentsUrl(a, `/${created.body.id}`))
        .set(reception.auth)
        .send({ scheduledAt: '2031-03-10T15:00:00.000Z' })
        .expect(200);
      expect(moved.body).toMatchObject(expected);
      const noted = await ctx
        .http()
        .patch(appointmentsUrl(a, `/${created.body.id}`))
        .set(reception.auth)
        .send({ notes: 'Trazer exames' })
        .expect(200);
      expect(noted.body).toMatchObject({ ...expected, notes: 'Trazer exames' });
    });
  });

  describe('nomes e saldo no financeiro', () => {
    it('cobranças trazem patient, paidCents e balanceCents; pagamentos trazem recordedBy', async () => {
      const created = await ctx
        .http()
        .post(chargesUrl(a))
        .set(a.auth)
        .send({ patientId: patient.id, description: 'Consulta', amountCents: 10_000, dueDate: '2031-01-10' })
        .expect(201);
      expect(created.body).toMatchObject({
        patient: { id: patient.id, fullName: 'Maria Paciente' },
        paidCents: 0,
        balanceCents: 10_000,
      });

      const payment = await ctx
        .http()
        .post(chargesUrl(a, `/${created.body.id}/payments`))
        .set(a.auth)
        .send({ amountCents: 3_000, method: 'pix' })
        .expect(201);
      expect(payment.body.recordedBy).toEqual({ id: a.id, name: 'Dono front-a' });

      const list = await ctx.http().get(chargesUrl(a)).query({ patientId: patient.id }).set(a.auth).expect(200);
      const row = list.body.data.find((c: { id: string }) => c.id === created.body.id);
      expect(row).toMatchObject({
        patient: { id: patient.id, fullName: 'Maria Paciente' },
        paidCents: 3_000,
        balanceCents: 7_000,
        status: 'pending',
      });

      const detail = await ctx.http().get(chargesUrl(a, `/${created.body.id}`)).set(a.auth).expect(200);
      expect(detail.body).toMatchObject({ paidCents: 3_000, balanceCents: 7_000 });
      expect(detail.body.payments[0].recordedBy).toEqual({ id: a.id, name: 'Dono front-a' });

      const payments = await ctx.http().get(chargesUrl(a, `/${created.body.id}/payments`)).set(a.auth).expect(200);
      expect(payments.body[0].recordedBy).toEqual({ id: a.id, name: 'Dono front-a' });

      // Quitada: saldo zero.
      await ctx
        .http()
        .post(chargesUrl(a, `/${created.body.id}/payments`))
        .set(a.auth)
        .send({ amountCents: 7_000, method: 'cash' })
        .expect(201);
      const paid = await ctx.http().get(chargesUrl(a, `/${created.body.id}`)).set(a.auth).expect(200);
      expect(paid.body).toMatchObject({ status: 'paid', paidCents: 10_000, balanceCents: 0 });
    });

    it('cobrança cancelada não tem saldo devedor', async () => {
      const created = await ctx
        .http()
        .post(chargesUrl(a))
        .set(a.auth)
        .send({ patientId: patient.id, description: 'Avulsa', amountCents: 5_000, dueDate: '2031-01-10' })
        .expect(201);
      await ctx.http().delete(chargesUrl(a, `/${created.body.id}`)).set(a.auth).expect(200);
      const res = await ctx.http().get(chargesUrl(a, `/${created.body.id}`)).set(a.auth).expect(200);
      expect(res.body).toMatchObject({ status: 'cancelled', paidCents: 0, balanceCents: 0 });
    });
  });

  describe('pacientes: null limpa birthDate e address', () => {
    it('PATCH com null zera os campos (antes era ignorado / dava erro)', async () => {
      const created = await createPatient(ctx.http, a, {
        birthDate: '1990-05-20',
        address: { cidade: 'Recife', uf: 'PE' },
        phone: '81999990000',
      });

      const res = await ctx
        .http()
        .patch(`/tenants/${a.tenantId}/patients/${created.id}`)
        .set(a.auth)
        .send({ birthDate: null, address: null, phone: null })
        .expect(200);
      expect(res.body).toMatchObject({ birthDate: null, address: null, phone: null });

      // Ausente continua não mexendo.
      await ctx
        .http()
        .patch(`/tenants/${a.tenantId}/patients/${created.id}`)
        .set(a.auth)
        .send({ birthDate: '1991-01-02' })
        .expect(200);
      const after = await ctx
        .http()
        .patch(`/tenants/${a.tenantId}/patients/${created.id}`)
        .set(a.auth)
        .send({ notes: 'só notas' })
        .expect(200);
      expect(after.body.birthDate).toBe('1991-01-02T00:00:00.000Z');
    });
  });
});
