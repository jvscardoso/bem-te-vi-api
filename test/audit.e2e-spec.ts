import {
  cleanupTenants,
  createAnamnesisTemplate,
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

interface AuditRow {
  id: string;
  action: string;
  patientId: string | null;
  actorUserId: string;
  actor: { id: string; name: string | null };
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

// Trilha de auditoria (LGPD): quem acessou ou alterou dado de paciente.
// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Trilha de auditoria (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;
  let doctor: TestUser;

  const patientsUrl = (suffix = '') => `/tenants/${a.tenantId}/patients${suffix}`;
  const logs = async (query: Record<string, string | number> = {}, as: TestUser = a) =>
    (await ctx.http().get(`/tenants/${a.tenantId}/audit-logs`).query(query).set(as.auth).expect(200)).body as {
      data: AuditRow[];
      meta: { total: number };
    };
  const logsOf = async (patientId: string) => (await logs({ patientId, pageSize: 100 })).data;

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'audit-a');
    b = await signupTenant(ctx.http, 'audit-b');
    doctor = await createUser(ctx.http, a, 'medico');
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId]);
    await ctx.app.close();
  });

  it('ver um paciente registra quem viu, quando, de onde e com qual navegador', async () => {
    const patient = await createPatient(ctx.http, a);
    await ctx.http().get(patientsUrl(`/${patient.id}`)).set(doctor.auth).set('User-Agent', 'Navegador de Teste/1.0').expect(200);

    const view = (await logsOf(patient.id)).find((row) => row.action === 'patient.view')!;
    expect(view).toMatchObject({
      patientId: patient.id,
      actorUserId: doctor.id,
      actor: { id: doctor.id, name: 'medico' },
      userAgent: 'Navegador de Teste/1.0',
    });
    expect(view.ip).toBeTruthy();
    expect(view).not.toHaveProperty('tenantId');
  });

  it('criar, alterar, remover e restaurar ficam registrados; a alteração guarda de → para', async () => {
    const created = await ctx
      .http()
      .post(patientsUrl())
      .set(a.auth)
      .send({ fullName: 'Paciente Auditado', phone: '81999990000', birthDate: '1990-05-20' })
      .expect(201);
    const id = created.body.id as string;

    await ctx
      .http()
      .patch(patientsUrl(`/${id}`))
      .set(a.auth)
      .send({ fullName: 'Paciente Auditado Silva', phone: '81999990000', birthDate: null })
      .expect(200);
    await ctx.http().delete(patientsUrl(`/${id}`)).set(a.auth).expect(200);
    await ctx.http().post(patientsUrl(`/${id}/restore`)).set(a.auth).expect(201);

    const rows = await logsOf(id);
    // Mais recente primeiro.
    expect(rows.map((row) => row.action)).toEqual(['patient.restore', 'patient.delete', 'patient.update', 'patient.create']);

    const update = rows.find((row) => row.action === 'patient.update')!;
    // Só o que mudou: o telefone foi reenviado igual e não aparece.
    expect(update.details).toEqual({
      changes: {
        fullName: { from: 'Paciente Auditado', to: 'Paciente Auditado Silva' },
        birthDate: { from: '1990-05-20T00:00:00.000Z', to: null },
      },
    });
  });

  it('a busca registra o termo procurado e o total, não cada paciente da página', async () => {
    const term = `busca${uniq()}`;
    await ctx.http().get(patientsUrl()).query({ q: term }).set(doctor.auth).expect(200);

    const { data } = await logs({ action: 'patient.list', actorUserId: doctor.id, pageSize: 100 });
    const row = data.find((entry) => entry.details?.q === term)!;
    expect(row).toMatchObject({ patientId: null, details: { q: term, page: 1, pageSize: 20, total: 0 } });
  });

  it('registro clínico: criar e listar ficam registrados, sem copiar o conteúdo clínico para a trilha', async () => {
    const patient = await createPatient(ctx.http, a);
    const template = await createAnamnesisTemplate(ctx.http, a);
    const record = await ctx
      .http()
      .post(patientsUrl(`/${patient.id}/anamnesis-records`))
      .set(doctor.auth)
      .send({ templateId: template.id, answers: { queixa: 'conteúdo clínico sigiloso' } })
      .expect(201);
    await ctx.http().get(patientsUrl(`/${patient.id}/anamnesis-records`)).set(a.auth).expect(200);

    const rows = await logsOf(patient.id);
    expect(rows.find((row) => row.action === 'clinical_record.create')).toMatchObject({
      actorUserId: doctor.id,
      entityType: 'anamnesis_record',
      entityId: record.body.id,
    });
    expect(rows.find((row) => row.action === 'clinical_record.list')).toMatchObject({
      actorUserId: a.id,
      details: { count: 1 },
    });
    expect(JSON.stringify(rows)).not.toContain('sigiloso');
  });

  it('acesso que falha (paciente inexistente) não gera registro', async () => {
    const before = (await logs({ actorUserId: doctor.id })).meta.total;
    await ctx.http().get(patientsUrl('/00000000-0000-4000-8000-000000000000')).set(doctor.auth).expect(404);
    expect((await logs({ actorUserId: doctor.id })).meta.total).toBe(before);
  });

  it('filtra por paciente, por usuário, por ação e por período', async () => {
    const patient = await createPatient(ctx.http, a);
    await ctx.http().get(patientsUrl(`/${patient.id}`)).set(doctor.auth).expect(200);
    await ctx.http().get(patientsUrl(`/${patient.id}`)).set(a.auth).expect(200);

    const byDoctor = await logs({ patientId: patient.id, actorUserId: doctor.id });
    expect(byDoctor.data.map((row) => row.action)).toEqual(['patient.view']);

    const views = await logs({ patientId: patient.id, action: 'patient.view' });
    expect(views.meta.total).toBe(2);

    const future = await logs({ patientId: patient.id, from: '2100-01-01T00:00:00.000Z' });
    expect(future.meta.total).toBe(0);
  });

  it('valida os filtros (400)', async () => {
    await ctx.http().get(`/tenants/${a.tenantId}/audit-logs`).query({ action: 'patient.hack' }).set(a.auth).expect(400);
    await ctx.http().get(`/tenants/${a.tenantId}/audit-logs`).query({ patientId: 'x' }).set(a.auth).expect(400);
  });

  it('exige audit:read (o Admin do cadastro já tem) e isola clínicas', async () => {
    const me = await ctx.http().get('/auth/me').set(a.auth).expect(200);
    expect(me.body.permissions).toContain('audit:read');

    const ids = await permissionIds(ctx.prisma, ['patients:read', 'patients:write']);
    const role = await ctx.http().post(`/tenants/${a.tenantId}/roles`).set(a.auth).send({ name: `Recepção ${uniq()}`, permissionIds: ids }).expect(201);
    const reception = await createUser(ctx.http, a, 'recepcao', { roleId: role.body.id });
    await ctx.http().get(`/tenants/${a.tenantId}/audit-logs`).set(reception.auth).expect(403);

    await ctx.http().get(`/tenants/${a.tenantId}/audit-logs`).set(b.auth).expect(403);
    const own = await ctx.http().get(`/tenants/${b.tenantId}/audit-logs`).set(b.auth).expect(200);
    expect(own.body.data.every((row: AuditRow) => row.actorUserId === b.id)).toBe(true);
  });

  it('é imutável: o banco recusa alterar um registro', async () => {
    const [row] = (await logs({ pageSize: 1 })).data;
    await expect(
      ctx.prisma.auditLog.update({ where: { id: row.id }, data: { action: 'patient.list' } }),
    ).rejects.toThrow(/somente inserção/);
  });
});
