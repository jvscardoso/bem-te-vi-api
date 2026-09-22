import {
  PASSWORD,
  cleanupTenants,
  createTestApp,
  createUser,
  permissionIds,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

const BASE_DOMAIN = 'bemtevi.test';
const PUBLIC_KEYS = ['logoUrl', 'name', 'primaryColor', 'secondaryColor', 'tradeName'];

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Branding / whitelabel (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;
  let subA: string;
  const extraTenantIds: string[] = [];

  const brandingUrl = (t: TestTenant) => `/tenants/${t.tenantId}/branding`;
  const patchBranding = (t: TestTenant, body: Record<string, unknown>) =>
    ctx.http().patch(brandingUrl(t)).set(t.auth).send(body);
  const publicBranding = (host: string) => ctx.http().get('/public/branding').query({ host });

  const subdomainOf = async (t: TestTenant) =>
    (await ctx.prisma.tenant.findUniqueOrThrow({ where: { id: t.tenantId } })).subdomain;

  beforeAll(async () => {
    // O ConfigService lê process.env no momento do uso; precisa estar definido antes de subir.
    process.env.APP_BASE_DOMAIN = BASE_DOMAIN;
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'br-a');
    b = await signupTenant(ctx.http, 'br-b');
    subA = await subdomainOf(a);
  });

  afterAll(async () => {
    delete process.env.APP_BASE_DOMAIN;
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId, ...extraTenantIds]);
    await ctx.app.close();
  });

  describe('PATCH /tenants/:id/branding', () => {
    it('cria a marca na primeira chamada e depois atualiza só o que foi enviado', async () => {
      const created = await patchBranding(a, {
        tradeName: 'Clínica Sorriso',
        logoUrl: 'https://cdn.exemplo.com/logo.png',
        primaryColor: '#1A73E8',
        secondaryColor: '#ffffff',
      }).expect(200);
      expect(created.body).toMatchObject({
        tenantId: a.tenantId,
        tradeName: 'Clínica Sorriso',
        logoUrl: 'https://cdn.exemplo.com/logo.png',
        primaryColor: '#1A73E8',
        secondaryColor: '#ffffff',
      });

      const updated = await patchBranding(a, { primaryColor: '#00aa55' }).expect(200);
      expect(updated.body).toMatchObject({
        tradeName: 'Clínica Sorriso',
        primaryColor: '#00aa55',
        secondaryColor: '#ffffff',
      });
      expect(updated.body.id).toBe(created.body.id);
    });

    it('a marca aparece em GET /tenants/:id', async () => {
      const res = await ctx.http().get(`/tenants/${a.tenantId}`).set(a.auth).expect(200);
      expect(res.body.branding).toMatchObject({ tradeName: 'Clínica Sorriso', primaryColor: '#00aa55' });
    });

    it('null limpa um campo sem mexer nos outros', async () => {
      const res = await patchBranding(a, { logoUrl: null, tradeName: null }).expect(200);

      expect(res.body).toMatchObject({
        logoUrl: null,
        tradeName: null,
        primaryColor: '#00aa55',
        secondaryColor: '#ffffff',
      });
    });

    it.each(['#fff', 'ff0000', '#12345678', '#GGGGGG', 'red', '#12345', ''])(
      'recusa cor inválida %j (400, não 500)',
      async (color) => {
        await patchBranding(a, { primaryColor: color }).expect(400);
        await patchBranding(a, { secondaryColor: color }).expect(400);
      },
    );

    it.each([
      'http://cdn.exemplo.com/logo.png',
      'ftp://cdn.exemplo.com/logo.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'cdn.exemplo.com/logo.png',
      'não é url',
      `https://cdn.exemplo.com/${'a'.repeat(2100)}.png`,
    ])('recusa logoUrl que não seja https válido: %j', async (logoUrl) => {
      await patchBranding(a, { logoUrl }).expect(400);
    });

    it('recusa nome fantasia longo demais e campos desconhecidos', async () => {
      await patchBranding(a, { tradeName: 'x'.repeat(151) }).expect(400);
      await patchBranding(a, { corDoTema: '#000000' }).expect(400);
    });

    it('exige tenant:manage e não altera a marca de outro tenant', async () => {
      const [readPatients] = await permissionIds(ctx.prisma, ['patients:read']);
      const role = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(a.auth)
        .send({ name: `Leitura ${Date.now()}`, permissionIds: [readPatients] })
        .expect(201);
      const limited = await createUser(ctx.http, a, 'sem-branding', { roleId: role.body.id });

      await ctx.http().patch(brandingUrl(a)).set(limited.auth).send({ primaryColor: '#000000' }).expect(403);
      await ctx.http().patch(brandingUrl(a)).set(b.auth).send({ primaryColor: '#000000' }).expect(403);
      await ctx.http().patch(brandingUrl(a)).send({ primaryColor: '#000000' }).expect(401);

      const res = await ctx.http().get(`/tenants/${a.tenantId}`).set(a.auth).expect(200);
      expect(res.body.branding.primaryColor).toBe('#00aa55');
    });
  });

  describe('domínio próprio (customDomain)', () => {
    const domain = `agenda-${uniq()}.exemplo.com.br`;

    it('normaliza para minúsculas no signup e recusa domínio inválido', async () => {
      const suffix = uniq();
      const body = (customDomain: string) => ({
        name: `Clinica dom ${suffix}`,
        subdomain: `clinica-dom-${suffix}`,
        customDomain,
        owner: { name: 'Dono', email: `dono-dom-${suffix}@teste.com`, password: PASSWORD },
      });

      for (const invalid of ['não é domínio', 'https://agenda.exemplo.com.br', 'localhost', 'a b.com']) {
        await ctx.http().post('/tenants').send(body(invalid)).expect(400);
      }

      const res = await ctx.http().post('/tenants').send(body(`  ${domain.toUpperCase()} `)).expect(201);
      extraTenantIds.push(res.body.tenant.id);
      expect(res.body.tenant.customDomain).toBe(domain);
    });

    it('domínio já usado por outra clínica dá 409', async () => {
      const res = await ctx
        .http()
        .patch(`/tenants/${b.tenantId}`)
        .set(b.auth)
        .send({ customDomain: domain })
        .expect(409);
      expect(res.body.message).toMatch(/domínio/i);
    });

    it('pode ser definido e normalizado depois do signup', async () => {
      const own = `painel-${uniq()}.exemplo.com.br`;
      const res = await ctx
        .http()
        .patch(`/tenants/${b.tenantId}`)
        .set(b.auth)
        .send({ customDomain: own.toUpperCase() })
        .expect(200);
      expect(res.body.customDomain).toBe(own);
    });
  });

  describe('GET /public/branding (resolução por host, sem login)', () => {
    beforeAll(async () => {
      await patchBranding(a, {
        tradeName: 'Clínica Sorriso',
        logoUrl: 'https://cdn.exemplo.com/logo.png',
        primaryColor: '#1a73e8',
        secondaryColor: '#ffffff',
      }).expect(200);
    });

    it('resolve pelo subdomínio e devolve só campos de marca', async () => {
      const res = await publicBranding(`${subA}.${BASE_DOMAIN}`).expect(200);

      expect(res.body).toEqual({
        name: expect.stringContaining('Clinica br-a'),
        tradeName: 'Clínica Sorriso',
        logoUrl: 'https://cdn.exemplo.com/logo.png',
        primaryColor: '#1a73e8',
        secondaryColor: '#ffffff',
      });
      expect(Object.keys(res.body).sort()).toEqual(PUBLIC_KEYS);
    });

    it('não vaza id, status nem configurações do tenant', async () => {
      const res = await publicBranding(`${subA}.${BASE_DOMAIN}`).expect(200);
      const raw = JSON.stringify(res.body);

      expect(raw).not.toContain(a.tenantId);
      for (const forbidden of ['id', 'tenantId', 'status', 'subdomain', 'customDomain', 'defaultAppointmentDurationMinutes']) {
        expect(res.body).not.toHaveProperty(forbidden);
      }
    });

    it('ignora maiúsculas, porta e ponto final', async () => {
      await publicBranding(`${subA.toUpperCase()}.${BASE_DOMAIN.toUpperCase()}:3000`).expect(200);
      await publicBranding(`${subA}.${BASE_DOMAIN}.`).expect(200);
    });

    it('resolve pelo domínio próprio', async () => {
      const own = `marca-${uniq()}.exemplo.com.br`;
      await ctx.http().patch(`/tenants/${a.tenantId}`).set(a.auth).send({ customDomain: own }).expect(200);

      const res = await publicBranding(own).expect(200);
      expect(res.body.tradeName).toBe('Clínica Sorriso');
      await publicBranding(own.toUpperCase()).expect(200);
    });

    it('aceita o subdomínio puro (uso em dev, sem domínio base)', async () => {
      const res = await publicBranding(subA).expect(200);
      expect(res.body.tradeName).toBe('Clínica Sorriso');
    });

    it('não casa hosts que só parecem o da clínica (404)', async () => {
      await publicBranding(`${subA}.outro-dominio.com`).expect(404);
      await publicBranding(`extra.${subA}.${BASE_DOMAIN}`).expect(404);
      await publicBranding(BASE_DOMAIN).expect(404);
      await publicBranding(`nao-existe-${uniq()}.${BASE_DOMAIN}`).expect(404);
      await publicBranding(`nao-existe-${uniq()}.exemplo.com.br`).expect(404);
    });

    it('clínica sem marca configurada devolve o nome e o resto nulo', async () => {
      const fresh = await signupTenant(ctx.http, 'br-fresh');
      extraTenantIds.push(fresh.tenantId);

      const res = await publicBranding(`${await subdomainOf(fresh)}.${BASE_DOMAIN}`).expect(200);
      expect(res.body).toEqual({
        name: expect.stringContaining('Clinica br-fresh'),
        tradeName: null,
        logoUrl: null,
        primaryColor: null,
        secondaryColor: null,
      });
    });

    it('reflete alterações da marca imediatamente (sem cache no servidor)', async () => {
      await patchBranding(a, { primaryColor: '#123456' }).expect(200);
      const res = await publicBranding(`${subA}.${BASE_DOMAIN}`).expect(200);
      expect(res.body.primaryColor).toBe('#123456');
    });

    it('permite cache curto no navegador/CDN', async () => {
      const res = await publicBranding(`${subA}.${BASE_DOMAIN}`).expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
    });

    it('valida a query (host obrigatório, sem parâmetros extras)', async () => {
      await ctx.http().get('/public/branding').expect(400);
      await publicBranding('').expect(400);
      await ctx.http().get('/public/branding').query({ host: subA, x: 1 }).expect(400);
    });

    it('clínica suspensa responde como inexistente', async () => {
      const suspended = await signupTenant(ctx.http, 'br-susp');
      extraTenantIds.push(suspended.tenantId);
      const host = `${await subdomainOf(suspended)}.${BASE_DOMAIN}`;
      await publicBranding(host).expect(200);

      await ctx.prisma.tenant.update({ where: { id: suspended.tenantId }, data: { status: 'suspended' } });

      await publicBranding(host).expect(404);
    });
  });
});
