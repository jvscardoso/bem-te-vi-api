import { randomUUID } from 'node:crypto';
import {
  PASSWORD,
  cleanupTenants,
  createTestApp,
  createUser,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

// Erros do banco (unique/FK) precisam virar 409/404, nunca 500.
describe('Tradução de erros do banco (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'er');
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId]);
    await ctx.app.close();
  });

  it('signup com subdomínio já usado dá 409', async () => {
    const other = await ctx
      .http()
      .post('/tenants')
      .send({
        name: 'Clone',
        subdomain: (await ctx.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }))
          .subdomain,
        owner: { name: 'Clone', email: `clone-${uniq()}@teste.com`, password: PASSWORD },
      })
      .expect(409);
    expect(other.body.message).toMatch(/subdomínio/i);
  });

  it('papel com nome repetido no mesmo tenant dá 409', async () => {
    const url = `/tenants/${a.tenantId}/roles`;
    await ctx.http().post(url).set(a.auth).send({ name: 'Duplicado' }).expect(201);
    await ctx.http().post(url).set(a.auth).send({ name: 'Duplicado' }).expect(409);
  });

  it('não apaga papel que ainda tem usuários (409) e apaga o que está livre (200)', async () => {
    const url = `/tenants/${a.tenantId}/roles`;
    const inUse = await ctx.http().post(url).set(a.auth).send({ name: 'EmUso' }).expect(201);
    await createUser(ctx.http, a, 'usuario-emuso', { roleId: inUse.body.id });

    await ctx.http().delete(`${url}/${inUse.body.id}`).set(a.auth).expect(409);

    const free = await ctx.http().post(url).set(a.auth).send({ name: 'Livre' }).expect(201);
    await ctx.http().delete(`${url}/${free.body.id}`).set(a.auth).expect(200);
    await ctx.http().get(`${url}/${free.body.id}`).set(a.auth).expect(404);
  });

  it('criar usuário com email já usado dá 409', async () => {
    const existing = await createUser(ctx.http, a, 'usuario-dup');
    await ctx
      .http()
      .post(`/tenants/${a.tenantId}/users`)
      .set(a.auth)
      .send({ name: 'Dup', email: existing.email, password: PASSWORD, roleId: a.roleId })
      .expect(409);
  });

  it('atribuir permissão inexistente a um papel dá 409 (FK), não 500', async () => {
    await ctx
      .http()
      .post(`/tenants/${a.tenantId}/roles`)
      .set(a.auth)
      .send({ name: 'Fantasma', permissionIds: [randomUUID()] })
      .expect(409);
  });
});
