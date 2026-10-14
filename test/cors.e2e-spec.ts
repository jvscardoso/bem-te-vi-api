import { cleanupTenants, createTestApp, signupTenant, uniq, type TestApp, type TestTenant } from './helpers/e2e.js';

// Quais sites podem chamar a API pelo navegador (CorsOriginPolicy). O app de teste sobe com o
// mesmo configureApp do main.ts. As variáveis são lidas na hora do uso, então cada teste pode
// definir as suas.
describe('CORS (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'cors');
  });

  afterEach(() => {
    delete process.env.APP_BASE_DOMAIN;
    delete process.env.CORS_EXTRA_ORIGINS;
    process.env.NODE_ENV = 'test';
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId]);
    await ctx.app.close();
  });

  // Rota pública qualquer: o CORS vale igual para todas.
  const fromOrigin = (origin: string) => ctx.http().get('/public/legal').set('Origin', origin);
  const allowedOrigin = async (origin: string) =>
    (await fromOrigin(origin).expect(200)).headers['access-control-allow-origin'];

  it('origem desconhecida não recebe Access-Control-Allow-Origin', async () => {
    expect(await allowedOrigin('https://site-malicioso.example')).toBeUndefined();
  });

  it('requisição sem Origin (curl, Postman, servidor) continua funcionando', async () => {
    await ctx.http().get('/public/legal').expect(200);
  });

  it('subdomínios do domínio base são liberados, com a origem ecoada e credentials', async () => {
    process.env.APP_BASE_DOMAIN = 'bemtevi.test';
    const res = await fromOrigin('https://clinica-a.bemtevi.test').expect(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://clinica-a.bemtevi.test');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(await allowedOrigin('https://bemtevi.test')).toBe('https://bemtevi.test');
    // Domínio que só termina com o mesmo texto não é subdomínio.
    expect(await allowedOrigin('https://outrobemtevi.test')).toBeUndefined();
  });

  it('domínio próprio só depois de verificado por DNS', async () => {
    const domain = `agenda-${uniq()}.clinica-cors.test`;
    await ctx.prisma.tenant.update({ where: { id: a.tenantId }, data: { customDomain: domain } });
    expect(await allowedOrigin(`https://${domain}`)).toBeUndefined();

    const verified = `verificado-${uniq()}.clinica-cors.test`;
    await ctx.prisma.tenant.update({
      where: { id: a.tenantId },
      data: { customDomain: verified, customDomainVerifiedAt: new Date() },
    });
    expect(await allowedOrigin(`https://${verified}`)).toBe(`https://${verified}`);
  });

  it('CORS_EXTRA_ORIGINS libera origens exatas (ex.: a landing em outro domínio)', async () => {
    process.env.CORS_EXTRA_ORIGINS = 'https://landing.example, https://admin.example/';
    expect(await allowedOrigin('https://landing.example')).toBe('https://landing.example');
    expect(await allowedOrigin('https://admin.example')).toBe('https://admin.example');
    // Mesmo host em outro protocolo ou porta é outra origem.
    expect(await allowedOrigin('http://landing.example')).toBeUndefined();
    expect(await allowedOrigin('https://landing.example:8443')).toBeUndefined();
  });

  it('fora de produção: localhost e *.localhost em qualquer porta (o Vite do front)', async () => {
    expect(await allowedOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(await allowedOrigin('http://clinica-a.localhost:5173')).toBe('http://clinica-a.localhost:5173');
  });

  it('em produção: nada de localhost nem de http, mesmo no domínio base', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_DOMAIN = 'bemtevi.test';
    expect(await allowedOrigin('http://localhost:5173')).toBeUndefined();
    expect(await allowedOrigin('http://clinica-a.bemtevi.test')).toBeUndefined();
    expect(await allowedOrigin('https://clinica-a.bemtevi.test')).toBe('https://clinica-a.bemtevi.test');
  });

  it('preflight (OPTIONS) responde às origens liberadas e não às outras', async () => {
    const preflight = (origin: string) =>
      ctx
        .http()
        .options(`/tenants/${a.tenantId}/patients`)
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type');

    const ok = await preflight('http://localhost:5173').expect(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-methods']).toContain('POST');

    const blocked = await preflight('https://site-malicioso.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
