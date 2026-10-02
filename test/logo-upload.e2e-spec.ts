import {
  cleanupTenants,
  createTestApp,
  createUser,
  permissionIds,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

// PNG 1x1 real; JPEG/WebP só com a assinatura (a detecção olha os primeiros bytes).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// Upload do logo da clínica, guardado no banco e servido por uma rota pública.
// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Upload de logo (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;
  let subA: string;

  const logoUrl = (t: TestTenant) => `/tenants/${t.tenantId}/branding/logo`;
  const upload = (t: TestTenant, data: Buffer, filename = 'logo.png', contentType = 'image/png', as = t) =>
    ctx.http().put(logoUrl(t)).set(as.auth).attach('file', data, { filename, contentType });
  // A API grava a URL absoluta (API_PUBLIC_URL); nos testes, só o caminho interessa.
  const pathOf = (url: string) => new URL(url).pathname;

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'logo-a');
    b = await signupTenant(ctx.http, 'logo-b');
    subA = (await ctx.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).subdomain;
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId]);
    await ctx.app.close();
  });

  it('envia um PNG, a marca passa a apontar para ele e a rota pública o serve', async () => {
    const res = await upload(a, PNG).expect(200);
    expect(res.body.logoUrl).toMatch(/^https?:\/\/[^/]+\/public\/logos\/[0-9a-f-]{36}$/);

    // Sem token: é a imagem da tela de login.
    const image = await ctx.http().get(pathOf(res.body.logoUrl)).buffer(true).expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(Buffer.from(image.body).equals(PNG)).toBe(true);
    expect(image.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    // Sem isto o navegador bloquearia o <img> do frontend (outra origem): o helmet põe same-origin.
    expect(image.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(image.headers['x-content-type-options']).toBe('nosniff');

    const branding = await ctx.http().get('/public/branding').query({ host: subA }).expect(200);
    expect(branding.body.logoUrl).toBe(res.body.logoUrl);
  });

  it('aceita JPEG e WebP; o tipo vem do conteúdo, não do que o cliente declara', async () => {
    const jpeg = await upload(a, JPEG, 'foto.png', 'image/png').expect(200);
    const served = await ctx.http().get(pathOf(jpeg.body.logoUrl)).expect(200);
    expect(served.headers['content-type']).toBe('image/jpeg');

    const webp = await upload(a, WEBP, 'logo.webp', 'image/webp').expect(200);
    expect((await ctx.http().get(pathOf(webp.body.logoUrl)).expect(200)).headers['content-type']).toBe('image/webp');
  });

  it('recusa SVG e o que não é imagem, mesmo declarado como imagem (400)', async () => {
    const svg = await upload(a, SVG, 'logo.svg', 'image/svg+xml').expect(400);
    expect(svg.body.message).toContain('PNG, JPEG ou WebP');
    await upload(a, Buffer.from('nao sou uma imagem'), 'logo.png', 'image/png').expect(400);
  });

  it('trocar o logo gera URL nova; a antiga deixa de existir (cache imutável continua correto)', async () => {
    const first = await upload(a, PNG).expect(200);
    const second = await upload(a, PNG).expect(200);
    expect(second.body.logoUrl).not.toBe(first.body.logoUrl);

    await ctx.http().get(pathOf(first.body.logoUrl)).expect(404);
    await ctx.http().get(pathOf(second.body.logoUrl)).expect(200);
    expect(await ctx.prisma.tenantLogo.count({ where: { tenantId: a.tenantId } })).toBe(1);
  });

  it('acima de 1 MB → 413; sem arquivo → 400', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    await upload(a, big).expect(413);
    await ctx.http().put(logoUrl(a)).set(a.auth).expect(400);
  });

  it('DELETE remove o logo: logoUrl null e a URL some', async () => {
    const res = await upload(a, PNG).expect(200);
    const removed = await ctx.http().delete(logoUrl(a)).set(a.auth).expect(200);
    expect(removed.body.logoUrl).toBeNull();
    await ctx.http().get(pathOf(res.body.logoUrl)).expect(404);
  });

  it('trocar por uma URL externa (PATCH branding) descarta o logo enviado', async () => {
    const res = await upload(a, PNG).expect(200);
    await ctx
      .http()
      .patch(`/tenants/${a.tenantId}/branding`)
      .set(a.auth)
      .send({ logoUrl: 'https://cdn.exemplo.com/logo.png' })
      .expect(200);

    await ctx.http().get(pathOf(res.body.logoUrl)).expect(404);
    expect(await ctx.prisma.tenantLogo.count({ where: { tenantId: a.tenantId } })).toBe(0);
  });

  it('exige tenant:manage (403) e isola clínicas (403); id inexistente → 404', async () => {
    const [patientsRead] = await permissionIds(ctx.prisma, ['patients:read']);
    const role = await ctx
      .http()
      .post(`/tenants/${a.tenantId}/roles`)
      .set(a.auth)
      .send({ name: `Leitura ${uniq()}`, permissionIds: [patientsRead] })
      .expect(201);
    const reader = await createUser(ctx.http, a, 'leitor', { roleId: role.body.id });

    await upload(a, PNG, 'logo.png', 'image/png', reader as TestTenant).expect(403);
    await ctx.http().delete(logoUrl(a)).set(reader.auth).expect(403);
    await upload(b, PNG, 'logo.png', 'image/png', a).expect(403);
    await ctx.http().get('/public/logos/00000000-0000-4000-8000-000000000000').expect(404);
  });
});
