import {
  FakeEmailSender,
  PASSWORD,
  cleanupTenants,
  createAnamnesisTemplate,
  createPatient,
  createPlatformAdmin,
  createTestApp,
  createUser,
  permissionIds,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// Saída da clínica (LGPD): exportação completa, pedido de encerramento com carência e exclusão
// definitiva pela plataforma.
// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Encerramento de conta da clínica (e2e)', () => {
  let ctx: TestApp;
  let mail: FakeEmailSender;
  let a: TestTenant;
  let platform: TestTenant;
  const extraTenantIds: string[] = [];

  const closureUrl = (t: TestTenant) => `/tenants/${t.tenantId}/closure`;
  const subdomainOf = async (t: TestTenant) =>
    (await ctx.prisma.tenant.findUniqueOrThrow({ where: { id: t.tenantId } })).subdomain;

  beforeAll(async () => {
    delete process.env.TENANT_DELETION_GRACE_DAYS;
    process.env.PLATFORM_CONTACT_EMAIL = 'plataforma@bemtevi.test';
    mail = new FakeEmailSender();
    ctx = await createTestApp({ emailSender: mail });
    a = await signupTenant(ctx.http, 'close-a');
    platform = await createPlatformAdmin(ctx);
  });

  afterAll(async () => {
    delete process.env.TENANT_DELETION_GRACE_DAYS;
    delete process.env.PLATFORM_CONTACT_EMAIL;
    await cleanupTenants(ctx.prisma, [a?.tenantId, platform?.tenantId, ...extraTenantIds]);
    await ctx.app.close();
  });

  describe('exportação completa', () => {
    it('baixa tudo da clínica num JSON, sem nenhum segredo', async () => {
      const patient = await createPatient(ctx.http, a, { fullName: 'Paciente da Clínica' });
      const template = await createAnamnesisTemplate(ctx.http, a);
      await ctx
        .http()
        .post(`/tenants/${a.tenantId}/patients/${patient.id}/anamnesis-records`)
        .set(a.auth)
        .send({ templateId: template.id, answers: { queixa: 'Dor' } })
        .expect(201);
      await ctx
        .http()
        .put(`/tenants/${a.tenantId}/branding/logo`)
        .set(a.auth)
        .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' })
        .expect(200);
      // Gera um token de convite no banco, para provar que ele não sai na exportação.
      await ctx
        .http()
        .post(`/tenants/${a.tenantId}/users`)
        .set(a.auth)
        .send({ name: 'Convidada', email: `convidada-${uniq()}@teste.com`, roleId: a.roleId })
        .expect(201);

      const res = await ctx.http().get(`/tenants/${a.tenantId}/export`).set(a.auth).expect(200);
      const subdomain = await subdomainOf(a);
      expect(res.headers['content-disposition']).toMatch(new RegExp(`^attachment; filename="clinica-${subdomain}-\\d{4}-\\d{2}-\\d{2}\\.json"$`));
      expect(res.headers['cache-control']).toBe('no-store');

      const body = res.body;
      expect(body).toMatchObject({ format: 'bem-te-vi.clinic-export', version: 1, clinic: { id: a.tenantId, subdomain } });
      expect(body.logo).toEqual({ mimeType: 'image/png', base64: PNG.toString('base64') });
      expect(body.patients.map((p: { id: string }) => p.id)).toContain(patient.id);
      expect(body.anamnesisTemplates).toHaveLength(1);
      expect(body.anamnesisRecords).toHaveLength(1);
      expect(body.roles.find((r: { name: string }) => r.name === 'Admin').permissions).toContain('patients:export');
      expect(body.users.length).toBeGreaterThanOrEqual(2);
      expect(body.legalAcceptances.length).toBeGreaterThanOrEqual(2);
      expect(body.auditLogs.length).toBeGreaterThan(0);

      const raw = JSON.stringify(body);
      for (const secret of ['passwordHash', 'passwordVersion', 'tokenHash', 'customDomainVerificationToken']) {
        expect(raw).not.toContain(secret);
      }
    });

    it('fica na trilha de auditoria e exige tenant:manage + patients:export', async () => {
      await ctx.http().get(`/tenants/${a.tenantId}/export`).set(a.auth).expect(200);
      const logs = await ctx.http().get(`/tenants/${a.tenantId}/audit-logs`).query({ action: 'tenant.export' }).set(a.auth).expect(200);
      expect(logs.body.meta.total).toBeGreaterThan(0);

      // Só tenant:manage (sem patients:export) não basta.
      const ids = await permissionIds(ctx.prisma, ['tenant:manage']);
      const role = await ctx.http().post(`/tenants/${a.tenantId}/roles`).set(a.auth).send({ name: `Gestão ${uniq()}`, permissionIds: ids }).expect(201);
      const manager = await createUser(ctx.http, a, 'gestor', { roleId: role.body.id });
      await ctx.http().get(`/tenants/${a.tenantId}/export`).set(manager.auth).expect(403);
    });
  });

  describe('pedido de encerramento', () => {
    it('exige a senha de quem pede; com ela, registra o pedido e a data a partir da qual a exclusão é possível', async () => {
      const t = await signupTenant(ctx.http, 'close-b');
      extraTenantIds.push(t.tenantId);

      const wrong = await ctx.http().post(closureUrl(t)).set(t.auth).send({ password: 'senha-errada' }).expect(400);
      expect(wrong.body.message).toBe('Senha incorreta');

      const before = Date.now();
      const res = await ctx.http().post(closureUrl(t)).set(t.auth).send({ password: PASSWORD }).expect(200);
      expect(res.body.graceDays).toBe(30);
      const requestedAt = Date.parse(res.body.closureRequestedAt);
      expect(requestedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(res.body.deletionAvailableAt) - requestedAt).toBe(30 * DAY_MS);

      // A clínica continua funcionando e vê o pedido.
      const tenant = await ctx.http().get(`/tenants/${t.tenantId}`).set(t.auth).expect(200);
      expect(tenant.body.closureRequestedAt).toBe(res.body.closureRequestedAt);
      expect((await ctx.http().get(closureUrl(t)).set(t.auth).expect(200)).body).toEqual(res.body);

      await ctx.http().post(closureUrl(t)).set(t.auth).send({ password: PASSWORD }).expect(409);
    });

    it('avisa quem pediu e a plataforma por email', async () => {
      const t = await signupTenant(ctx.http, 'close-mail');
      extraTenantIds.push(t.tenantId);
      await ctx.http().post(closureUrl(t)).set(t.auth).send({ password: PASSWORD }).expect(200);

      await vi.waitFor(() => expect(mail.to(t.email)).toHaveLength(1), { timeout: 10_000 });
      expect(mail.to(t.email)[0].subject).toContain('pedido de encerramento');
      await vi.waitFor(
        () => expect(mail.to('plataforma@bemtevi.test').some((m) => m.text.includes(t.email.toLowerCase()))).toBe(true),
        { timeout: 10_000 },
      );
    });

    it('pode ser cancelado durante a carência; tudo fica na trilha de auditoria', async () => {
      const t = await signupTenant(ctx.http, 'close-cancel');
      extraTenantIds.push(t.tenantId);
      await ctx.http().post(closureUrl(t)).set(t.auth).send({ password: PASSWORD }).expect(200);

      const res = await ctx.http().delete(closureUrl(t)).set(t.auth).expect(200);
      expect(res.body).toMatchObject({ closureRequestedAt: null, deletionAvailableAt: null });
      await ctx.http().delete(closureUrl(t)).set(t.auth).expect(409);

      const logs = await ctx.http().get(`/tenants/${t.tenantId}/audit-logs`).set(t.auth).expect(200);
      const actions = logs.body.data.map((row: { action: string }) => row.action);
      expect(actions).toEqual(expect.arrayContaining(['tenant.closure_requested', 'tenant.closure_cancelled']));
    });

    it('exige tenant:manage', async () => {
      const ids = await permissionIds(ctx.prisma, ['patients:read']);
      const role = await ctx.http().post(`/tenants/${a.tenantId}/roles`).set(a.auth).send({ name: `Leitura ${uniq()}`, permissionIds: ids }).expect(201);
      const reader = await createUser(ctx.http, a, 'leitor', { roleId: role.body.id });
      await ctx.http().post(closureUrl(a)).set(reader.auth).send({ password: PASSWORD }).expect(403);
    });
  });

  describe('exclusão definitiva pela plataforma', () => {
    const del = (id: string, confirmSubdomain: string, as: TestTenant = platform) =>
      ctx.http().delete(`/platform/tenants/${id}`).set(as.auth).send({ confirmSubdomain });

    it('só para clínica que pediu o encerramento, depois da carência, confirmando o subdomínio', async () => {
      const t = await signupTenant(ctx.http, 'close-del');
      extraTenantIds.push(t.tenantId);
      const subdomain = await subdomainOf(t);
      await createPatient(ctx.http, t);

      // Sem pedido da clínica: a plataforma não apaga por conta própria.
      await del(t.tenantId, subdomain).expect(409);

      await ctx.http().post(closureUrl(t)).set(t.auth).send({ password: PASSWORD }).expect(200);
      const listed = await ctx.http().get('/platform/tenants').query({ q: subdomain }).set(platform.auth).expect(200);
      expect(listed.body.data[0].closureRequestedAt).not.toBeNull();

      // Dentro da carência.
      const early = await del(t.tenantId, subdomain).expect(409);
      expect(early.body.message).toContain('carência');

      process.env.TENANT_DELETION_GRACE_DAYS = '0';
      try {
        await del(t.tenantId, 'outro-subdominio').expect(400);
        await del(t.tenantId, subdomain).expect(204);
      } finally {
        delete process.env.TENANT_DELETION_GRACE_DAYS;
      }

      expect(await ctx.prisma.tenant.count({ where: { id: t.tenantId } })).toBe(0);
      expect(await ctx.prisma.patient.count({ where: { tenantId: t.tenantId } })).toBe(0);
      expect(await ctx.prisma.auditLog.count({ where: { tenantId: t.tenantId } })).toBe(0);
      await ctx.http().post('/auth/login').send({ email: t.email, password: PASSWORD }).expect(401);

      const proof = await ctx.prisma.tenantDeletion.findFirstOrThrow({ where: { tenantId: t.tenantId } });
      expect(proof).toMatchObject({ subdomain, deletedByUserId: platform.id });
    });

    it('exige platform:manage; a clínica-plataforma não pode ser excluída', async () => {
      await del(a.tenantId, await subdomainOf(a), a).expect(403);
      await del(platform.tenantId, await subdomainOf(platform)).expect(404);
    });
  });
});
