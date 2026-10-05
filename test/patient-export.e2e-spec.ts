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

// Exportação dos dados de um paciente (direito de acesso/portabilidade do titular, LGPD).
// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Exportação dos dados do paciente (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;
  let doctor: TestUser;
  let patient: { id: string };
  let templateId: string;

  const url = (patientId: string, t: TestTenant = a) => `/tenants/${t.tenantId}/patients/${patientId}/export`;

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'export-a');
    b = await signupTenant(ctx.http, 'export-b');
    doctor = await createUser(ctx.http, a, 'Exporta');
    patient = await createPatient(ctx.http, a, { fullName: 'Paciente Exportado', cpf: '39053344705' });

    const template = await ctx
      .http()
      .post(`/tenants/${a.tenantId}/anamnesis-templates`)
      .set(a.auth)
      .send({
        name: `Ficha ${uniq()}`,
        fields: [
          { key: 'queixa', label: 'Queixa principal', type: 'textarea', required: true },
          { key: 'fumante', label: 'Fumante?', type: 'boolean', required: false },
          { key: 'antigo', label: 'Campo que será removido', type: 'text', required: false },
        ],
      })
      .expect(201);
    templateId = template.body.id;
    await ctx
      .http()
      .post(`/tenants/${a.tenantId}/patients/${patient.id}/anamnesis-records`)
      .set(doctor.auth)
      .send({ templateId, answers: { fumante: false, queixa: 'Dor nas costas', antigo: 'valor antigo' } })
      .expect(201);
    // O formulário muda depois da ficha: o campo "antigo" deixa de existir.
    await ctx
      .http()
      .patch(`/tenants/${a.tenantId}/anamnesis-templates/${templateId}`)
      .set(a.auth)
      .send({
        fields: [
          { key: 'queixa', label: 'Queixa principal', type: 'textarea', required: true },
          { key: 'fumante', label: 'Fumante?', type: 'boolean', required: false },
        ],
      })
      .expect(200);

    const appointment = await ctx
      .http()
      .post(`/tenants/${a.tenantId}/appointments`)
      .set(a.auth)
      .send({ patientId: patient.id, professionalId: doctor.id, scheduledAt: '2031-02-03T13:00:00.000Z' })
      .expect(201);
    const charge = await ctx
      .http()
      .post(`/tenants/${a.tenantId}/charges`)
      .set(a.auth)
      .send({ patientId: patient.id, appointmentId: appointment.body.id, description: 'Consulta', amountCents: 20_000, dueDate: '2031-02-10' })
      .expect(201);
    await ctx
      .http()
      .post(`/tenants/${a.tenantId}/charges/${charge.body.id}/payments`)
      .set(a.auth)
      .send({ amountCents: 5_000, method: 'pix' })
      .expect(201);
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId]);
    await ctx.app.close();
  });

  it('baixa um JSON com cadastro, fichas legíveis, agenda e cobranças', async () => {
    const res = await ctx.http().get(url(patient.id)).set(a.auth).expect(200);

    expect(res.headers['content-disposition']).toBe(`attachment; filename="paciente-${patient.id}.json"`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      format: 'bem-te-vi.patient-export',
      version: 1,
      clinic: { name: expect.stringContaining('Clinica export-a') },
      patient: { id: patient.id, fullName: 'Paciente Exportado', cpf: '39053344705', deletedAt: null },
    });
    expect(res.body.patient).not.toHaveProperty('tenantId');
    expect(Date.parse(res.body.exportedAt)).not.toBeNaN();

    const [record] = res.body.clinicalRecords;
    expect(record.filledBy).toEqual({ id: doctor.id, name: 'Exporta' });
    // Na ordem do formulário, com rótulo; o campo que saiu do formulário vem no fim, sem rótulo.
    expect(record.answers).toEqual([
      { key: 'queixa', label: 'Queixa principal', type: 'textarea', value: 'Dor nas costas' },
      { key: 'fumante', label: 'Fumante?', type: 'boolean', value: false },
      { key: 'antigo', label: null, type: null, value: 'valor antigo' },
    ]);

    expect(res.body.appointments).toEqual([
      expect.objectContaining({ status: 'scheduled', professional: { id: doctor.id, name: 'Exporta' } }),
    ]);
    expect(res.body.charges).toEqual([
      expect.objectContaining({
        description: 'Consulta',
        amountCents: 20_000,
        payments: [expect.objectContaining({ amountCents: 5_000, method: 'pix' })],
      }),
    ]);
  });

  it('fica registrada na trilha de auditoria, com o que foi exportado', async () => {
    await ctx.http().get(url(patient.id)).set(a.auth).expect(200);
    const logs = await ctx
      .http()
      .get(`/tenants/${a.tenantId}/audit-logs`)
      .query({ patientId: patient.id, action: 'patient.export' })
      .set(a.auth)
      .expect(200);
    expect(logs.body.data[0]).toMatchObject({
      actorUserId: a.id,
      details: { clinicalRecords: 1, appointments: 1, charges: 1 },
    });
  });

  it('paciente removido também exporta (o pedido do titular continua valendo)', async () => {
    const removed = await createPatient(ctx.http, a, { fullName: 'Paciente Removido' });
    await ctx.http().delete(`/tenants/${a.tenantId}/patients/${removed.id}`).set(a.auth).expect(200);

    const res = await ctx.http().get(url(removed.id)).set(a.auth).expect(200);
    expect(res.body.patient.deletedAt).not.toBeNull();
  });

  it('exige patients:export (o Admin do cadastro já tem); isola clínicas; inexistente → 404', async () => {
    const me = await ctx.http().get('/auth/me').set(a.auth).expect(200);
    expect(me.body.permissions).toContain('patients:export');

    const ids = await permissionIds(ctx.prisma, ['patients:read', 'patients:write']);
    const role = await ctx.http().post(`/tenants/${a.tenantId}/roles`).set(a.auth).send({ name: `Recepção ${uniq()}`, permissionIds: ids }).expect(201);
    const reception = await createUser(ctx.http, a, 'recepcao', { roleId: role.body.id });
    await ctx.http().get(url(patient.id)).set(reception.auth).expect(403);

    await ctx.http().get(url(patient.id)).set(b.auth).expect(403);
    await ctx.http().get(url(patient.id, b)).set(b.auth).expect(404);
    await ctx.http().get(url('00000000-0000-4000-8000-000000000000')).set(a.auth).expect(404);
  });
});
