import {
  FakeEmailSender,
  LEGAL,
  PASSWORD,
  cleanupTenants,
  createTestApp,
  createUser,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

const tokenIn = (text: string) => /[?&]token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';

// Aceite de Termos de Uso e Política de Privacidade (LGPD): obrigatório no cadastro e no aceite
// de convite, registrado com versão/IP/navegador, e pendente quando a versão vigente muda.
// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Aceite de Termos e Política de Privacidade (e2e)', () => {
  let ctx: TestApp;
  let mail: FakeEmailSender;
  let a: TestTenant;
  const extraTenantIds: string[] = [];

  const signupBody = (suffix: string, legalAcceptance?: unknown) => ({
    name: `Clinica legal ${suffix}`,
    subdomain: `clinica-legal-${suffix}`,
    owner: { name: 'Dono', email: `dono-legal-${suffix}@teste.com`, password: PASSWORD },
    ...(legalAcceptance !== undefined ? { legalAcceptance } : {}),
  });
  const me = async (auth: { Authorization: string }) => (await ctx.http().get('/auth/me').set(auth).expect(200)).body;
  const acceptancesOf = (userId: string) =>
    ctx.prisma.legalAcceptance.findMany({ where: { userId }, orderBy: [{ acceptedAt: 'asc' }, { document: 'asc' }] });

  beforeAll(async () => {
    delete process.env.LEGAL_TERMS_VERSION;
    delete process.env.LEGAL_PRIVACY_VERSION;
    mail = new FakeEmailSender();
    ctx = await createTestApp({ emailSender: mail });
    a = await signupTenant(ctx.http, 'legal-a');
  });

  afterAll(async () => {
    delete process.env.LEGAL_TERMS_VERSION;
    delete process.env.LEGAL_PRIVACY_VERSION;
    await cleanupTenants(ctx.prisma, [a?.tenantId, ...extraTenantIds]);
    await ctx.app.close();
  });

  it('GET /public/legal informa as versões vigentes, sem token', async () => {
    const res = await ctx.http().get('/public/legal').expect(200);
    expect(res.body).toEqual({ terms: { version: '1' }, privacy: { version: '1' } });
  });

  describe('cadastro da clínica', () => {
    it('sem aceite ou com versão desatualizada → 400, e nada é criado', async () => {
      const suffix = uniq();
      await ctx.http().post('/tenants').send(signupBody(suffix)).expect(400);
      const old = await ctx
        .http()
        .post('/tenants')
        .send(signupBody(suffix, { termsVersion: '0', privacyVersion: '1' }))
        .expect(400);
      expect(old.body.message).toContain('versão vigente');

      expect(await ctx.prisma.tenant.count({ where: { subdomain: `clinica-legal-${suffix}` } })).toBe(0);
    });

    it('com aceite vigente, registra os dois aceites do dono com IP e navegador', async () => {
      const suffix = uniq();
      const res = await ctx
        .http()
        .post('/tenants')
        .set('User-Agent', 'Navegador de Teste/2.0')
        .send(signupBody(suffix, LEGAL))
        .expect(201);
      extraTenantIds.push(res.body.tenant.id);

      const rows = await acceptancesOf(res.body.owner.id);
      expect(rows.map((row) => `${row.document}@${row.version}`).sort()).toEqual(['privacy@1', 'terms@1']);
      expect(rows[0]).toMatchObject({ tenantId: res.body.tenant.id, userAgent: 'Navegador de Teste/2.0' });
      expect(rows[0].ip).toBeTruthy();
    });

    it('o dono não tem aceite pendente', async () => {
      expect((await me(a.auth)).pendingLegalDocuments).toEqual([]);
    });
  });

  describe('usuário criado com senha pelo admin', () => {
    it('fica com os dois documentos pendentes até aceitar em POST /auth/me/legal-acceptances', async () => {
      const user = await createUser(ctx.http, a, 'comsenha');
      expect((await me(user.auth)).pendingLegalDocuments).toEqual(['terms', 'privacy']);

      const res = await ctx.http().post('/auth/me/legal-acceptances').set(user.auth).send(LEGAL).expect(200);
      expect(res.body).toEqual({ pendingLegalDocuments: [] });
      expect((await me(user.auth)).pendingLegalDocuments).toEqual([]);
      expect(await acceptancesOf(user.id)).toHaveLength(2);
    });

    it('aceitar versão que não é a vigente → 400', async () => {
      const user = await createUser(ctx.http, a, 'versaoerrada');
      await ctx
        .http()
        .post('/auth/me/legal-acceptances')
        .set(user.auth)
        .send({ termsVersion: '1', privacyVersion: '9' })
        .expect(400);
      expect(await acceptancesOf(user.id)).toHaveLength(0);
    });
  });

  describe('aceite de convite', () => {
    it('exige o aceite; sem ele o link não é gasto e pode ser usado de novo com o aceite', async () => {
      const email = `convite-legal-${uniq()}@teste.com`;
      const created = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/users`)
        .set(a.auth)
        .send({ name: 'Convidada', email, roleId: a.roleId })
        .expect(201);
      await vi.waitFor(() => expect(mail.to(email)).toHaveLength(1), { timeout: 10_000 });
      const token = tokenIn(mail.to(email)[0].text);

      await ctx.http().post('/auth/accept-invite').send({ token, password: PASSWORD }).expect(400);
      await ctx
        .http()
        .post('/auth/accept-invite')
        .send({ token, password: PASSWORD, legalAcceptance: { termsVersion: '0', privacyVersion: '1' } })
        .expect(400);
      await ctx.http().post('/auth/accept-invite').send({ token, password: PASSWORD, legalAcceptance: LEGAL }).expect(200);

      expect(await acceptancesOf(created.body.id)).toHaveLength(2);
    });
  });

  describe('versão nova publicada', () => {
    it('quem aceitou a anterior volta a ter pendência só do documento que mudou; o histórico fica', async () => {
      const user = await createUser(ctx.http, a, 'versaonova');
      await ctx.http().post('/auth/me/legal-acceptances').set(user.auth).send(LEGAL).expect(200);

      process.env.LEGAL_TERMS_VERSION = '2';
      try {
        expect((await ctx.http().get('/public/legal').expect(200)).body.terms.version).toBe('2');
        expect((await me(user.auth)).pendingLegalDocuments).toEqual(['terms']);

        // A tela manda as duas versões vigentes; a da política não mudou.
        await ctx
          .http()
          .post('/auth/me/legal-acceptances')
          .set(user.auth)
          .send({ termsVersion: '2', privacyVersion: '1' })
          .expect(200);
        expect((await me(user.auth)).pendingLegalDocuments).toEqual([]);

        const terms = (await acceptancesOf(user.id)).filter((row) => row.document === 'terms');
        expect(terms.map((row) => row.version)).toEqual(['1', '2']);
      } finally {
        delete process.env.LEGAL_TERMS_VERSION;
      }
    });
  });
});
