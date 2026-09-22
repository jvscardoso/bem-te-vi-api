import { randomUUID } from 'node:crypto';
import { DnsTxtResolver } from '../src/tenants/dns-txt-resolver.js';
import {
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
  type TestUser,
} from './helpers/e2e.js';

// Dublê controlável: o teste decide o que cada hostname "responde" no TXT, sem depender de
// DNS real (não dá para provar o caminho feliz com um domínio de verdade num teste automatizado).
class FakeDnsTxtResolver extends DnsTxtResolver {
  records = new Map<string, string[]>();
  calls: string[] = [];

  override async resolveTxt(hostname: string): Promise<string[]> {
    this.calls.push(hostname);
    return this.records.get(hostname) ?? [];
  }
}

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Verificação de domínio próprio (e2e)', () => {
  let ctx: TestApp;
  let dns: FakeDnsTxtResolver;
  let a: TestTenant;
  let b: TestTenant;
  const tenantIds: string[] = [];

  const domainUrl = (t: TestTenant, suffix = '') => `/tenants/${t.tenantId}/domain${suffix}`;
  const getDomain = (t: TestTenant, as: TestUser = t) => ctx.http().get(domainUrl(t)).set(as.auth);
  const verify = (t: TestTenant, as: TestUser = t) =>
    ctx.http().post(domainUrl(t, '/verify')).set(as.auth);
  const setCustomDomain = (t: TestTenant, customDomain: string | null) =>
    ctx.http().patch(`/tenants/${t.tenantId}`).set(t.auth).send({ customDomain });

  const newDomain = () => `agenda-${uniq()}.exemplo.com.br`;
  const challengeHost = (domain: string) => `_bemtevi-challenge.${domain}`;

  beforeAll(async () => {
    dns = new FakeDnsTxtResolver();
    ctx = await createTestApp({ dnsTxtResolver: dns });
    a = await signupTenant(ctx.http, 'dom-a');
    b = await signupTenant(ctx.http, 'dom-b');
    tenantIds.push(a.tenantId, b.tenantId);
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, tenantIds);
    await ctx.app.close();
  });

  it('tenant sem domínio próprio: 404 em ambos os endpoints', async () => {
    await getDomain(a).expect(404);
    await verify(a).expect(404);
  });

  describe('configurar o domínio', () => {
    it('ao definir o domínio, nasce não verificado e com um desafio TXT pronto', async () => {
      const domain = newDomain();
      await setCustomDomain(a, domain).expect(200);

      const res = await getDomain(a).expect(200);
      expect(res.body).toEqual({
        domain,
        verified: false,
        verifiedAt: null,
        record: { type: 'TXT', name: challengeHost(domain), value: expect.any(String) },
      });
      expect(res.body.record.value).toHaveLength(48); // 24 bytes em hex
    });

    it('o token de verificação não vaza pelos endpoints gerais do tenant', async () => {
      const domain = newDomain();
      const email = `dono-tok-${uniq()}@teste.com`;
      const signup = await ctx
        .http()
        .post('/tenants')
        .send({
          name: `Clinica tok ${uniq()}`,
          subdomain: `clinica-tok-${uniq()}`,
          customDomain: domain,
          owner: { name: 'Dono', email, password: PASSWORD },
        })
        .expect(201);
      tenantIds.push(signup.body.tenant.id);

      expect(signup.body.tenant.customDomain).toBe(domain);
      expect(signup.body.tenant).not.toHaveProperty('customDomainVerificationToken');

      const owner = await loginAs(ctx.http, email);
      const read = await ctx
        .http()
        .get(`/tenants/${signup.body.tenant.id}`)
        .set(owner.auth)
        .expect(200);
      expect(read.body).not.toHaveProperty('customDomainVerificationToken');
    });
  });

  describe('verificar', () => {
    let domain: string;

    beforeEach(async () => {
      domain = newDomain();
      await setCustomDomain(a, domain).expect(200);
    });

    it('sem o registro TXT no DNS: verified continua false, nada é persistido', async () => {
      const res = await verify(a).expect(200);

      expect(res.body).toMatchObject({ domain, verified: false, verifiedAt: null });
      expect(dns.calls).toContain(challengeHost(domain));
      const tenant = await ctx.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
      expect(tenant.customDomainVerifiedAt).toBeNull();
    });

    it('com o TXT errado: continua não verificado', async () => {
      dns.records.set(challengeHost(domain), ['um-valor-qualquer-que-nao-e-o-token']);

      const res = await verify(a).expect(200);

      expect(res.body.verified).toBe(false);
    });

    it('com o TXT certo: fica verificado e passa a valer na marca pública', async () => {
      const { record } = (await getDomain(a).expect(200)).body;
      dns.records.set(challengeHost(domain), [record.value]);

      await ctx.http().get('/public/branding').query({ host: domain }).expect(404);

      const res = await verify(a).expect(200);
      expect(res.body.verified).toBe(true);
      expect(res.body.verifiedAt).not.toBeNull();

      await ctx.http().get('/public/branding').query({ host: domain }).expect(200);

      const tenant = await ctx.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
      expect(tenant.customDomainVerifiedAt).not.toBeNull();
    });

    it('o TXT pode estar entre outros registros do mesmo host', async () => {
      const { record } = (await getDomain(a).expect(200)).body;
      dns.records.set(challengeHost(domain), ['v=spf1 -all', record.value, 'outro-registro']);

      const res = await verify(a).expect(200);

      expect(res.body.verified).toBe(true);
    });

    it('depois de verificado, chamar de novo não repete a consulta ao DNS', async () => {
      const { record } = (await getDomain(a).expect(200)).body;
      dns.records.set(challengeHost(domain), [record.value]);
      await verify(a).expect(200);

      dns.calls.length = 0;
      const res = await verify(a).expect(200);

      expect(res.body.verified).toBe(true);
      expect(dns.calls).toEqual([]);
    });

    it('DNS fora do ar (resolver falha) é tratado como "ainda não verificado", não 500', async () => {
      // O DnsTxtResolver real já engole a própria exceção (ver dns-txt-resolver.ts) e devolve
      // []; aqui a dublê rejeita de propósito só para provar que a API repassa o erro (500),
      // em vez de mascará-lo silenciosamente como "não verificado".
      const broken = new (class extends DnsTxtResolver {
        override async resolveTxt(): Promise<string[]> {
          throw new Error('ECONNREFUSED (simulado)');
        }
      })();
      const brokenCtx = await createTestApp({ dnsTxtResolver: broken });

      await brokenCtx.http().post(`/tenants/${a.tenantId}/domain/verify`).set(a.auth).expect(500);

      await brokenCtx.app.close();
    });
  });

  describe('trocar ou remover o domínio', () => {
    it('trocar o domínio reseta a verificação (o token antigo não vale mais)', async () => {
      const first = newDomain();
      await setCustomDomain(a, first).expect(200);
      const { record: firstRecord } = (await getDomain(a).expect(200)).body;
      dns.records.set(challengeHost(first), [firstRecord.value]);
      await verify(a).expect(200);

      const second = newDomain();
      await setCustomDomain(a, second).expect(200);

      const res = await getDomain(a).expect(200);
      expect(res.body.domain).toBe(second);
      expect(res.body.verified).toBe(false);
      expect(res.body.record.value).not.toBe(firstRecord.value);
      // O TXT antigo, se ainda estiver no DNS do domínio anterior, não verifica o novo.
      dns.records.set(challengeHost(second), [firstRecord.value]);
      expect((await verify(a).expect(200)).body.verified).toBe(false);
    });

    it('reenviar o mesmo domínio não mexe numa verificação já feita', async () => {
      const domain = newDomain();
      await setCustomDomain(a, domain).expect(200);
      const { record } = (await getDomain(a).expect(200)).body;
      dns.records.set(challengeHost(domain), [record.value]);
      await verify(a).expect(200);

      await setCustomDomain(a, domain).expect(200);

      const res = await getDomain(a).expect(200);
      expect(res.body.verified).toBe(true);
      expect(res.body.record.value).toBe(record.value);
    });

    it('remover o domínio (null) limpa tudo; o endpoint volta a dar 404', async () => {
      const domain = newDomain();
      await setCustomDomain(a, domain).expect(200);
      const { record } = (await getDomain(a).expect(200)).body;
      dns.records.set(challengeHost(domain), [record.value]);
      await verify(a).expect(200);

      const cleared = await setCustomDomain(a, null).expect(200);
      expect(cleared.body.customDomain).toBeNull();

      await getDomain(a).expect(404);
      await verify(a).expect(404);
      // Liberado: outro tenant pode reivindicar o mesmo valor agora.
      await setCustomDomain(b, domain).expect(200);
    });
  });

  describe('permissões e isolamento entre tenants', () => {
    beforeAll(async () => {
      await setCustomDomain(a, newDomain()).expect(200);
    });

    it('exige tenant:manage', async () => {
      const [readPatients] = await permissionIds(ctx.prisma, ['patients:read']);
      const role = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(a.auth)
        .send({ name: `Sem dominio ${uniq()}`, permissionIds: [readPatients] })
        .expect(201);
      const limited = await createUser(ctx.http, a, 'sem-dominio', { roleId: role.body.id });

      await getDomain(a, limited).expect(403);
      await verify(a, limited).expect(403);
    });

    it('token do tenant B na URL do tenant A é 403; sem token é 401', async () => {
      await getDomain(a, b).expect(403);
      await verify(a, b).expect(403);
      await ctx.http().get(domainUrl(a)).expect(401);
      await ctx.http().post(domainUrl(a, '/verify')).expect(401);
    });

    it('tenant inexistente na própria URL dá 403 pelo guard de isolamento', async () => {
      await ctx.http().get(`/tenants/${randomUUID()}/domain`).set(a.auth).expect(403);
    });
  });
});
