import {
  cleanupTenants,
  createTestApp,
  createUser,
  loginAs,
  PASSWORD,
  permissionIds,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
  type TestUser,
} from './helpers/e2e.js';

const NEW_PASSWORD = 'Nova@Senha987';

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Senhas: troca pelo próprio usuário e redefinição pelo admin (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;

  const changeOwn = (as: TestUser, body: Record<string, unknown>) =>
    ctx.http().patch('/auth/me/password').set(as.auth).send(body);
  const reset = (t: TestTenant, userId: string, body: Record<string, unknown>, as: TestUser = t) =>
    ctx.http().patch(`/tenants/${t.tenantId}/users/${userId}/password`).set(as.auth).send(body);
  const login = (email: string, password: string) =>
    ctx.http().post('/auth/login').send({ email, password });
  const me = (as: { Authorization: string }) => ctx.http().get('/auth/me').set(as);

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'pwd-a');
    b = await signupTenant(ctx.http, 'pwd-b');
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId]);
    await ctx.app.close();
  });

  describe('PATCH /auth/me/password', () => {
    it('troca a senha, devolve um token novo e derruba as sessões antigas', async () => {
      const user = await createUser(ctx.http, a, 'troca');
      const otherSession = await loginAs(ctx.http, user.email);

      const res = await changeOwn(user, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(200);
      expect(typeof res.body.accessToken).toBe('string');

      // Todas as sessões anteriores (inclusive a usada na troca) deixam de valer.
      await me(user.auth).expect(401);
      await me(otherSession.auth).expect(401);
      // O token devolvido continua valendo: quem trocou não é deslogado.
      await me({ Authorization: `Bearer ${res.body.accessToken}` }).expect(200);

      await login(user.email, PASSWORD).expect(401);
      await login(user.email, NEW_PASSWORD).expect(200);
    });

    it('senha atual errada → 400 (não 401, para o cliente não deslogar) e nada muda', async () => {
      const user = await createUser(ctx.http, a, 'errada');
      const res = await changeOwn(user, { currentPassword: 'outra-coisa', newPassword: NEW_PASSWORD }).expect(400);
      expect(res.body.message).toBe('Senha atual incorreta');
      await me(user.auth).expect(200);
      await login(user.email, PASSWORD).expect(200);
    });

    it('valida a nova senha (mínimo 8) e os campos obrigatórios', async () => {
      const user = await createUser(ctx.http, a, 'curta');
      await changeOwn(user, { currentPassword: PASSWORD, newPassword: '1234567' }).expect(400);
      await changeOwn(user, { newPassword: NEW_PASSWORD }).expect(400);
      await changeOwn(user, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, extra: 1 }).expect(400);
    });

    it('sem token → 401', async () => {
      await ctx.http().patch('/auth/me/password').send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(401);
    });
  });

  describe('PATCH /tenants/:tenantId/users/:id/password', () => {
    it('admin redefine a senha de outro usuário (204) e derruba as sessões dele', async () => {
      const user = await createUser(ctx.http, a, 'reset');
      await reset(a, user.id, { password: NEW_PASSWORD }).expect(204);

      await me(user.auth).expect(401);
      await login(user.email, PASSWORD).expect(401);
      await login(user.email, NEW_PASSWORD).expect(200);
      // As sessões do admin não são afetadas.
      await me(a.auth).expect(200);
    });

    it('não serve para a própria senha (400): esse caminho exige a senha atual', async () => {
      const res = await reset(a, a.id, { password: NEW_PASSWORD }).expect(400);
      expect(res.body.message).toContain('/auth/me/password');
    });

    it('não redefine a senha de um usuário "acima" do ator (403)', async () => {
      const [usersManage] = await permissionIds(ctx.prisma, ['users:manage']);
      const role = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(a.auth)
        .send({ name: `Gestor ${uniq()}`, permissionIds: [usersManage] })
        .expect(201);
      const manager = await createUser(ctx.http, a, 'gestor', { roleId: role.body.id });

      await reset(a, a.id, { password: NEW_PASSWORD }, manager).expect(403);
      await login(a.email, PASSWORD).expect(200);
    });

    it('exige users:manage (403), senha válida (400) e usuário do tenant (404/403)', async () => {
      const [patientsRead] = await permissionIds(ctx.prisma, ['patients:read']);
      const role = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(a.auth)
        .send({ name: `Leitura ${uniq()}`, permissionIds: [patientsRead] })
        .expect(201);
      const reader = await createUser(ctx.http, a, 'leitor', { roleId: role.body.id });
      const target = await createUser(ctx.http, a, 'alvo');

      await reset(a, target.id, { password: NEW_PASSWORD }, reader).expect(403);
      await reset(a, target.id, { password: 'curta' }).expect(400);
      // Usuário de outra clínica pela URL do próprio tenant: não existe aqui.
      await reset(a, b.id, { password: NEW_PASSWORD }).expect(404);
      // URL de outra clínica: bloqueada pelo isolamento de tenant.
      await reset(b, b.id, { password: NEW_PASSWORD }, a).expect(403);
      await login(b.email, PASSWORD).expect(200);
    });

    it('nunca expõe o hash nem a versão da senha nas respostas de usuário', async () => {
      const res = await ctx.http().get(`/tenants/${a.tenantId}/users/${a.id}`).set(a.auth).expect(200);
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('passwordVersion');
    });
  });
});
