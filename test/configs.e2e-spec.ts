import {
  cleanupTenants,
  createTestApp,
  createUser,
  permissionIds,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
  type TestUser,
} from './helpers/e2e.js';

// Configurações de tela da clínica: hoje, o layout da tela inicial (layouts.home).
describe('Configurações de tela (/configs) (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;
  let member: TestUser; // sem tenant:manage

  const configsUrl = (t: TestTenant = a) => `/tenants/${t.tenantId}/configs`;
  const homeUrl = (t: TestTenant = a) => `${configsUrl(t)}/layouts/home`;
  const LAYOUT = {
    version: 1,
    widgets: [
      { id: 'w-1', type: 'financial-summary', width: 'full' },
      { id: 'w-2', type: 'today-count', width: 'third' },
      { id: 'w_3', type: 'today-agenda', width: 'two-thirds' },
    ],
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'configs-a');
    b = await signupTenant(ctx.http, 'configs-b');
    const role = await ctx
      .http()
      .post(`/tenants/${a.tenantId}/roles`)
      .set(a.auth)
      .send({ name: `Recepcao ${uniq()}`, permissionIds: await permissionIds(ctx.prisma, ['patients:read']) })
      .expect(201);
    member = await createUser(ctx.http, a, 'recepcao-configs', { roleId: role.body.id });
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId]);
    await ctx.app.close();
  });

  it('clínica sem nada salvo: todas as telas conhecidas vêm null', async () => {
    const res = await ctx.http().get(configsUrl(b)).set(b.auth).expect(200);
    expect(res.body).toEqual({ layouts: { home: null } });
  });

  it('salva com tenant:manage e o GET traz o layout, com quando e quem salvou', async () => {
    const saved = await ctx.http().put(homeUrl()).set(a.auth).send(LAYOUT).expect(200);
    expect(saved.body).toMatchObject({ ...LAYOUT, updatedBy: { id: a.id, name: expect.any(String) } });
    expect(Date.parse(saved.body.updatedAt)).not.toBeNaN();

    const res = await ctx.http().get(configsUrl()).set(a.auth).expect(200);
    expect(res.body.layouts.home).toEqual(saved.body);
  });

  it('qualquer usuário da clínica lê; só quem tem tenant:manage salva e restaura', async () => {
    await ctx.http().put(homeUrl()).set(a.auth).send(LAYOUT).expect(200);
    const read = await ctx.http().get(configsUrl()).set(member.auth).expect(200);
    expect(read.body.layouts.home.widgets).toEqual(LAYOUT.widgets);

    await ctx.http().put(homeUrl()).set(member.auth).send(LAYOUT).expect(403);
    await ctx.http().delete(homeUrl()).set(member.auth).expect(403);
  });

  it('salvar de novo substitui a lista inteira (ordem incluída); lista vazia é válida', async () => {
    const reordered = { version: 1, widgets: [LAYOUT.widgets[2], LAYOUT.widgets[0]] };
    await ctx.http().put(homeUrl()).set(a.auth).send(reordered).expect(200);
    expect((await ctx.http().get(configsUrl()).set(a.auth).expect(200)).body.layouts.home.widgets).toEqual(
      reordered.widgets,
    );

    const empty = await ctx.http().put(homeUrl()).set(a.auth).send({ version: 1, widgets: [] }).expect(200);
    expect(empty.body.widgets).toEqual([]);
  });

  it('tipo de bloco que a API não conhece é aceito (o catálogo é do front)', async () => {
    const res = await ctx
      .http()
      .put(homeUrl())
      .set(a.auth)
      .send({ version: 1, widgets: [{ id: 'novo', type: 'novo-bloco', width: 'half' }] })
      .expect(200);
    expect(res.body.widgets[0].type).toBe('novo-bloco');
  });

  it('tela desconhecida → 404 "Tela não encontrada", no PUT e no DELETE', async () => {
    const res = await ctx.http().put(`${configsUrl()}/layouts/outra-tela`).set(a.auth).send(LAYOUT).expect(404);
    expect(res.body.message).toBe('Tela não encontrada');
    await ctx.http().delete(`${configsUrl()}/layouts/outra-tela`).set(a.auth).expect(404);
  });

  describe('validação (400, em português)', () => {
    const put = (body: unknown) => ctx.http().put(homeUrl()).set(a.auth).send(body as object).expect(400);
    const widget = (extra: Record<string, unknown> = {}) => ({ id: 'w-1', type: 'agenda', width: 'full', ...extra });

    it('largura fora da lista', async () => {
      const res = await put({ version: 1, widgets: [widget({ width: 'quarter' })] });
      expect(res.body.errors[0]).toMatchObject({ field: 'widgets.0.width', code: 'isIn' });
      expect(res.body.errors[0].message).toMatch(/^Largura do bloco inválida/);
    });

    it('id repetido', async () => {
      const res = await put({ version: 1, widgets: [widget(), widget({ type: 'outro' })] });
      expect(res.body.message).toEqual(['Os ids dos blocos devem ser únicos']);
    });

    it('mais de 24 blocos', async () => {
      const widgets = Array.from({ length: 25 }, (_, i) => widget({ id: `w-${i}` }));
      const res = await put({ version: 1, widgets });
      expect(res.body.message).toEqual(['Lista de blocos deve ter no máximo 24 itens']);
    });

    it('versão diferente de 1, ou ausente', async () => {
      expect((await put({ version: 2, widgets: [] })).body.errors[0]).toMatchObject({ field: 'version', code: 'isIn' });
      expect((await put({ widgets: [] })).body.errors[0]).toMatchObject({ field: 'version', code: 'required' });
    });

    it('formato do id e do tipo', async () => {
      const res = await put({ version: 1, widgets: [widget({ id: 'w 1', type: 'Agenda' })] });
      expect(res.body.message).toEqual([
        'O id do bloco deve ter só letras, números, "_" e "-"',
        'O tipo do bloco deve ter só letras minúsculas, números e "-"',
      ]);
    });

    it('campo extra, no corpo ou no bloco', async () => {
      expect((await put({ ...LAYOUT, extra: 1 })).body.errors[0]).toMatchObject({ code: 'unknownField' });
      expect((await put({ version: 1, widgets: [widget({ color: 'red' })] })).body.errors[0]).toMatchObject({
        field: 'widgets.0.color',
        code: 'unknownField',
      });
    });
  });

  it('DELETE volta ao padrão (204, home null) e é idempotente', async () => {
    await ctx.http().put(homeUrl()).set(a.auth).send(LAYOUT).expect(200);
    await ctx.http().delete(homeUrl()).set(a.auth).expect(204);
    expect((await ctx.http().get(configsUrl()).set(a.auth).expect(200)).body).toEqual({ layouts: { home: null } });
    await ctx.http().delete(homeUrl()).set(a.auth).expect(204);
  });

  it('isolamento: usuário de outra clínica não lê nem altera, e cada clínica tem o seu layout', async () => {
    await ctx.http().put(homeUrl()).set(a.auth).send(LAYOUT).expect(200);
    await ctx.http().get(configsUrl(a)).set(b.auth).expect(403);
    await ctx.http().put(homeUrl(a)).set(b.auth).send(LAYOUT).expect(403);
    await ctx.http().delete(homeUrl(a)).set(b.auth).expect(403);

    expect((await ctx.http().get(configsUrl(b)).set(b.auth).expect(200)).body.layouts.home).toBeNull();
  });

  it('sem token → 401', async () => {
    await ctx.http().get(configsUrl()).expect(401);
  });
});
