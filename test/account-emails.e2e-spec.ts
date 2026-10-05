import {
  LEGAL,
  FakeEmailSender,
  PASSWORD,
  cleanupTenants,
  createTestApp,
  createUser,
  loginAs,
  permissionIds,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

const NEW_PASSWORD = 'Nova@Senha987';
// Tempo para o envio em segundo plano acontecer, nos testes que provam que NADA foi enviado.
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));
// Espera pelo envio em segundo plano: o padrão do vi.waitFor (1s) é curto com a suíte toda em
// paralelo disputando CPU (bcrypt dos outros arquivos).
const WAIT = { timeout: 10_000 };
const tokenIn = (text: string) => /[?&]token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';

// Esqueci minha senha e convite por email. O envio é um dublê (FakeEmailSender): os testes leem
// o link do email "enviado", como a pessoa faria.
// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Emails de conta: recuperação de senha e convite (e2e)', () => {
  let ctx: TestApp;
  let mail: FakeEmailSender;
  let a: TestTenant;
  let b: TestTenant;
  let subA: string;
  let subB: string;

  const forgot = (body: Record<string, unknown>) => ctx.http().post('/auth/forgot-password').send(body);
  const reset = (token: string, password = NEW_PASSWORD) =>
    ctx.http().post('/auth/reset-password').send({ token, password });
  const accept = (token: string, password = NEW_PASSWORD) =>
    ctx.http().post('/auth/accept-invite').send({ token, password, legalAcceptance: LEGAL });
  const login = (email: string, password: string) => ctx.http().post('/auth/login').send({ email, password });
  const lastEmailTo = async (email: string) => {
    await vi.waitFor(() => expect(mail.to(email).length).toBeGreaterThan(0), WAIT);
    return mail.to(email).at(-1)!;
  };
  const subdomainOf = async (t: TestTenant) =>
    (await ctx.prisma.tenant.findUniqueOrThrow({ where: { id: t.tenantId } })).subdomain;

  beforeAll(async () => {
    delete process.env.APP_BASE_DOMAIN;
    delete process.env.FRONTEND_URL;
    mail = new FakeEmailSender();
    ctx = await createTestApp({ emailSender: mail });
    a = await signupTenant(ctx.http, 'mail-a');
    b = await signupTenant(ctx.http, 'mail-b');
    subA = await subdomainOf(a);
    subB = await subdomainOf(b);
  });

  afterAll(async () => {
    delete process.env.APP_BASE_DOMAIN;
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId]);
    await ctx.app.close();
  });

  describe('esqueci minha senha', () => {
    it('envia o link, a senha é redefinida e as sessões antigas caem', async () => {
      const user = await createUser(ctx.http, a, 'esqueci');
      await forgot({ email: user.email.toUpperCase() }).expect(204);

      const email = await lastEmailTo(user.email);
      expect(email.subject).toContain('redefinição de senha');
      // Dev (sem APP_BASE_DOMAIN): FRONTEND_URL padrão, com a clínica em ?tenant=.
      expect(email.text).toContain(`http://localhost:5173/reset-password?token=`);
      expect(email.text).toContain(`tenant=${subA}`);
      expect(email.html).toContain('href=');

      const res = await reset(tokenIn(email.text)).expect(200);
      expect(res.body).toEqual({ email: user.email.toLowerCase() });

      await ctx.http().get('/auth/me').set(user.auth).expect(401);
      await login(user.email, PASSWORD).expect(401);
      await login(user.email, NEW_PASSWORD).expect(200);
    });

    it('o link é de uso único', async () => {
      const user = await createUser(ctx.http, a, 'unico');
      await forgot({ email: user.email }).expect(204);
      const token = tokenIn((await lastEmailTo(user.email)).text);

      await reset(token).expect(200);
      const again = await reset(token, 'Outra@Senha123').expect(400);
      expect(again.body.message).toBe('Link inválido ou expirado');
      await login(user.email, NEW_PASSWORD).expect(200);
    });

    it('email inexistente: mesma resposta (204, sem corpo) e nenhum email', async () => {
      const ghost = `ninguem-${uniq()}@teste.com`;
      const res = await forgot({ email: ghost }).expect(204);
      expect(res.text).toBe('');
      await settle();
      expect(mail.to(ghost)).toHaveLength(0);
    });

    it('conta desativada ou convidada não recebe link', async () => {
      const disabled = await createUser(ctx.http, a, 'desativado');
      await ctx.http().patch(`/tenants/${a.tenantId}/users/${disabled.id}`).set(a.auth).send({ status: 'disabled' }).expect(200);
      await forgot({ email: disabled.email }).expect(204);

      const invitedEmail = `convidado-${uniq()}@teste.com`;
      await ctx.http().post(`/tenants/${a.tenantId}/users`).set(a.auth).send({ name: 'Convidado', email: invitedEmail, roleId: a.roleId }).expect(201);
      // O convite também é enviado em segundo plano: espera chegar antes de contar.
      await lastEmailTo(invitedEmail);
      const invitesSoFar = mail.to(invitedEmail).length;
      await forgot({ email: invitedEmail }).expect(204);

      await settle();
      expect(mail.to(disabled.email)).toHaveLength(0);
      expect(mail.to(invitedEmail)).toHaveLength(invitesSoFar);
    });

    it('pelo endereço de outra clínica não envia (mesma regra do login); pelo da própria, envia', async () => {
      const user = await createUser(ctx.http, a, 'hostcheck');
      await forgot({ email: user.email, host: subB }).expect(204);
      await settle();
      expect(mail.to(user.email)).toHaveLength(0);

      await forgot({ email: user.email, host: subA }).expect(204);
      await lastEmailTo(user.email);
    });

    it('o link sempre aponta para a clínica do usuário, nunca para o host informado', async () => {
      const user = await createUser(ctx.http, a, 'injecao');
      await forgot({ email: user.email, host: 'site-malicioso.test' }).expect(204);
      const email = await lastEmailTo(user.email);
      expect(email.text).not.toContain('site-malicioso');
      expect(email.text).toContain(`tenant=${subA}`);
    });

    it('com APP_BASE_DOMAIN, o link vai para <sub>.<APP_BASE_DOMAIN> por https', async () => {
      const user = await createUser(ctx.http, a, 'basedomain');
      process.env.APP_BASE_DOMAIN = 'bemtevi.test';
      try {
        await forgot({ email: user.email }).expect(204);
        const email = await lastEmailTo(user.email);
        expect(email.text).toContain(`https://${subA}.bemtevi.test/reset-password?token=`);
        expect(email.text).not.toContain('tenant=');
      } finally {
        delete process.env.APP_BASE_DOMAIN;
      }
    });

    it('pedir de novo invalida o link anterior', async () => {
      const user = await createUser(ctx.http, a, 'reenvio');
      await forgot({ email: user.email }).expect(204);
      const first = tokenIn((await lastEmailTo(user.email)).text);
      await forgot({ email: user.email }).expect(204);
      await vi.waitFor(() => expect(mail.to(user.email)).toHaveLength(2), WAIT);
      const second = tokenIn(mail.to(user.email)[1].text);

      await reset(first).expect(400);
      await reset(second).expect(200);
    });

    it('link expirado, inventado ou de convite não redefine a senha (400)', async () => {
      const user = await createUser(ctx.http, a, 'expirado');
      await forgot({ email: user.email }).expect(204);
      const token = tokenIn((await lastEmailTo(user.email)).text);
      await ctx.prisma.userToken.updateMany({
        where: { user: { email: user.email.toLowerCase() } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await reset(token).expect(400);
      await reset('token-que-nao-existe').expect(400);
      await login(user.email, PASSWORD).expect(200);
    });

    it('conta desativada depois do pedido: o link deixa de valer', async () => {
      const user = await createUser(ctx.http, a, 'desativadodepois');
      await forgot({ email: user.email }).expect(204);
      const token = tokenIn((await lastEmailTo(user.email)).text);
      await ctx.http().patch(`/tenants/${a.tenantId}/users/${user.id}`).set(a.auth).send({ status: 'disabled' }).expect(200);

      await reset(token).expect(400);
    });

    it('valida os campos (400)', async () => {
      await forgot({ email: 'nao-e-email' }).expect(400);
      await reset('qualquer', 'curta').expect(400);
      await ctx.http().post('/auth/reset-password').send({ password: NEW_PASSWORD }).expect(400);
    });
  });

  describe('convite', () => {
    const invite = (email: string, extra: Record<string, unknown> = {}) =>
      ctx.http().post(`/tenants/${a.tenantId}/users`).set(a.auth).send({ name: 'Dra. Convidada', email, roleId: a.roleId, ...extra });

    it('criar sem senha convida: status invited, email com link, aceite ativa a conta', async () => {
      const email = `convite-${uniq()}@teste.com`;
      const created = await invite(email).expect(201);
      expect(created.body.status).toBe('invited');
      await login(email, PASSWORD).expect(401);

      const message = await lastEmailTo(email);
      expect(message.subject).toContain('Convite para acessar');
      expect(message.text).toContain('http://localhost:5173/accept-invite?token=');
      expect(message.text).toContain('Dra. Convidada');

      const res = await accept(tokenIn(message.text)).expect(200);
      expect(res.body).toEqual({ email });

      await login(email, NEW_PASSWORD).expect(200);
      const user = await ctx.http().get(`/tenants/${a.tenantId}/users/${created.body.id}`).set(a.auth).expect(200);
      expect(user.body.status).toBe('active');
    });

    it('com senha, cria ativo e não envia convite (fluxo antigo)', async () => {
      const email = `direto-${uniq()}@teste.com`;
      const created = await invite(email, { password: PASSWORD }).expect(201);
      expect(created.body.status).toBe('active');
      await settle();
      expect(mail.to(email)).toHaveLength(0);
      await login(email, PASSWORD).expect(200);
    });

    it('o convite é de uso único e não serve para redefinir senha', async () => {
      const email = `uso-unico-${uniq()}@teste.com`;
      await invite(email).expect(201);
      const token = tokenIn((await lastEmailTo(email)).text);

      await reset(token).expect(400);
      await accept(token).expect(200);
      await accept(token, 'Outra@Senha123').expect(400);
    });

    it('reenviar gera um link novo e invalida o anterior', async () => {
      const email = `reenviar-${uniq()}@teste.com`;
      const created = await invite(email).expect(201);
      const first = tokenIn((await lastEmailTo(email)).text);

      await ctx.http().post(`/tenants/${a.tenantId}/users/${created.body.id}/invite`).set(a.auth).expect(204);
      await vi.waitFor(() => expect(mail.to(email)).toHaveLength(2), WAIT);
      const second = tokenIn(mail.to(email)[1].text);

      await accept(first).expect(400);
      await accept(second).expect(200);
    });

    it('reenviar para quem já está ativo → 409; sem users:manage → 403; outra clínica → 404', async () => {
      await ctx.http().post(`/tenants/${a.tenantId}/users/${a.id}/invite`).set(a.auth).expect(409);

      const [patientsRead] = await permissionIds(ctx.prisma, ['patients:read']);
      const role = await ctx.http().post(`/tenants/${a.tenantId}/roles`).set(a.auth).send({ name: `Leitura ${uniq()}`, permissionIds: [patientsRead] }).expect(201);
      const reader = await createUser(ctx.http, a, 'leitor', { roleId: role.body.id });
      const email = `alvo-${uniq()}@teste.com`;
      const created = await invite(email).expect(201);
      await ctx.http().post(`/tenants/${a.tenantId}/users/${created.body.id}/invite`).set(reader.auth).expect(403);

      await ctx.http().post(`/tenants/${a.tenantId}/users/${b.id}/invite`).set(a.auth).expect(404);
    });

    it('convite de conta desativada antes do aceite não reativa (400)', async () => {
      const email = `desativado-${uniq()}@teste.com`;
      const created = await invite(email).expect(201);
      const token = tokenIn((await lastEmailTo(email)).text);
      await ctx.http().patch(`/tenants/${a.tenantId}/users/${created.body.id}`).set(a.auth).send({ status: 'disabled' }).expect(200);

      await accept(token).expect(400);
      await login(email, NEW_PASSWORD).expect(401);
    });

    it('nunca expõe tokens nas respostas de usuário', async () => {
      const email = `sem-token-${uniq()}@teste.com`;
      const created = await invite(email).expect(201);
      expect(JSON.stringify(created.body)).not.toContain(tokenIn((await lastEmailTo(email)).text));
      expect(created.body).not.toHaveProperty('tokens');
    });
  });

  it('o dono continua logando normalmente (nada disso afeta quem não usou os fluxos)', async () => {
    await loginAs(ctx.http, a.email);
  });
});
