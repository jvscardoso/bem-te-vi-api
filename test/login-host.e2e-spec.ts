import { DnsTxtResolver } from '../src/tenants/dns-txt-resolver.js';
import {
  PASSWORD,
  cleanupTenants,
  createPlatformAdmin,
  createTestApp,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

class FakeDnsTxtResolver extends DnsTxtResolver {
  records = new Map<string, string[]>();

  override async resolveTxt(hostname: string): Promise<string[]> {
    return this.records.get(hostname) ?? [];
  }
}

const BASE_DOMAIN = 'bemtevi.test';
const INVALID = 'Credenciais inválidas';

// Login restrito à clínica do endereço: o host que resolve a marca exibida
// (GET /public/branding) também decide quem pode entrar por ali.
// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Login restrito à clínica do host (e2e)', () => {
  let ctx: TestApp;
  let dns: FakeDnsTxtResolver;
  let a: TestTenant;
  let b: TestTenant;
  let platform: TestTenant;
  let subA: string;
  let subB: string;
  const domainA = `agenda-${uniq()}.clinica-a.test`;
  const extraTenantIds: string[] = [];

  const login = (email: string, host?: string, password = PASSWORD) =>
    ctx.http().post('/auth/login').send({ email, password, ...(host !== undefined ? { host } : {}) });
  const subdomainOf = async (t: TestTenant) =>
    (await ctx.prisma.tenant.findUniqueOrThrow({ where: { id: t.tenantId } })).subdomain;

  beforeAll(async () => {
    // O ConfigService lê process.env no momento do uso; precisa estar definido antes de subir.
    process.env.APP_BASE_DOMAIN = BASE_DOMAIN;
    dns = new FakeDnsTxtResolver();
    ctx = await createTestApp({ dnsTxtResolver: dns });
    a = await signupTenant(ctx.http, 'lh-a');
    b = await signupTenant(ctx.http, 'lh-b');
    platform = await createPlatformAdmin(ctx);
    subA = await subdomainOf(a);
    subB = await subdomainOf(b);

    // Domínio próprio verificado para a clínica A.
    await ctx.http().patch(`/tenants/${a.tenantId}`).set(a.auth).send({ customDomain: domainA }).expect(200);
    const { record } = (await ctx.http().get(`/tenants/${a.tenantId}/domain`).set(a.auth).expect(200)).body;
    dns.records.set(record.name, [record.value]);
    await ctx.http().post(`/tenants/${a.tenantId}/domain/verify`).set(a.auth).expect(200);
  });

  afterAll(async () => {
    delete process.env.APP_BASE_DOMAIN;
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId, platform?.tenantId, ...extraTenantIds]);
    await ctx.app.close();
  });

  describe('host da própria clínica', () => {
    it('subdomínio da plataforma (<sub>.APP_BASE_DOMAIN) → 200', async () => {
      await login(a.email, `${subA}.${BASE_DOMAIN}`).expect(200);
    });

    it('domínio próprio verificado → 200', async () => {
      await login(a.email, domainA).expect(200);
    });

    it('subdomínio puro (dev, ?tenant=) → 200', async () => {
      await login(a.email, subA).expect(200);
    });

    it('maiúsculas e porta são ignoradas → 200', async () => {
      await login(a.email, `${subA.toUpperCase()}:5173`).expect(200);
      await login(a.email, `${subA}.${BASE_DOMAIN.toUpperCase()}:443`).expect(200);
    });
  });

  describe('host de outra clínica', () => {
    it('→ 401 com a mesma mensagem genérica de senha errada', async () => {
      const otherClinic = await login(a.email, `${subB}.${BASE_DOMAIN}`).expect(401);
      const wrongPassword = await login(a.email, `${subA}.${BASE_DOMAIN}`, 'senha-errada').expect(401);

      expect(otherClinic.body.message).toBe(INVALID);
      expect(otherClinic.body).toEqual(wrongPassword.body);
    });

    it('vale também pelo subdomínio puro e pelo domínio próprio da outra clínica', async () => {
      await login(b.email, subA).expect(401);
      await login(b.email, domainA).expect(401);
    });

    it('login recusado não conta como acesso (lastLoginAt não muda)', async () => {
      const before = await ctx.prisma.user.findUniqueOrThrow({ where: { id: b.id }, select: { lastLoginAt: true } });
      await login(b.email, subA).expect(401);
      const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: b.id }, select: { lastLoginAt: true } });
      expect(after.lastLoginAt).toEqual(before.lastLoginAt);
    });
  });

  describe('host sem clínica: comportamento de antes', () => {
    it('sem host → 200 (compatibilidade)', async () => {
      await login(a.email).expect(200);
    });

    it('domínio principal da plataforma ou host desconhecido → 200', async () => {
      await login(a.email, BASE_DOMAIN).expect(200);
      await login(a.email, `nao-existe-${uniq()}.${BASE_DOMAIN}`).expect(200);
      await login(a.email, 'qualquer.outro-site.test').expect(200);
    });

    it('domínio próprio ainda não verificado não resolve → 200 para qualquer clínica', async () => {
      const c = await signupTenant(ctx.http, 'lh-c');
      extraTenantIds.push(c.tenantId);
      const domainC = `nao-verificado-${uniq()}.clinica-c.test`;
      await ctx.http().patch(`/tenants/${c.tenantId}`).set(c.auth).send({ customDomain: domainC }).expect(200);

      await login(c.email, domainC).expect(200);
      await login(a.email, domainC).expect(200);
    });

    it('clínica suspensa não resolve (a marca dela também dá 404) → não restringe', async () => {
      const d = await signupTenant(ctx.http, 'lh-d');
      extraTenantIds.push(d.tenantId);
      const subD = await subdomainOf(d);
      await ctx.prisma.tenant.update({ where: { id: d.tenantId }, data: { status: 'suspended' } });

      await ctx.http().get('/public/branding').query({ host: subD }).expect(404);
      await login(a.email, subD).expect(200);
      // O usuário da própria clínica suspensa continua barrado pela regra de sempre.
      await login(d.email, subD).expect(401);
    });
  });

  describe('usuários da plataforma', () => {
    it('entram pelo domínio principal e são recusados no endereço de uma clínica', async () => {
      await login(platform.email, BASE_DOMAIN).expect(200);
      const res = await login(platform.email, `${subA}.${BASE_DOMAIN}`).expect(401);
      expect(res.body.message).toBe(INVALID);
    });

    it('entram pelo endereço da própria clínica-plataforma', async () => {
      await login(platform.email, await subdomainOf(platform)).expect(200);
    });
  });

  describe('validação de host', () => {
    it('precisa ser texto de até 255 caracteres (400)', async () => {
      await ctx.http().post('/auth/login').send({ email: a.email, password: PASSWORD, host: 123 }).expect(400);
      await login(a.email, 'a'.repeat(256)).expect(400);
    });

    it('vazio não aponta para clínica nenhuma → 200', async () => {
      await login(a.email, '').expect(200);
    });
  });
});
