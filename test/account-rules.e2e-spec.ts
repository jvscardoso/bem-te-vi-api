import { randomUUID } from 'node:crypto';
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

// Lido do catálogo real no beforeAll (não hardcoded): toda vez que uma permissão nova é
// adicionada ao catálogo, esta lista já reflete automaticamente, sem precisar editar o teste
// (já aconteceu duas vezes — anamnesis_templates e depois billing — de esquecer de atualizar
// uma lista fixa aqui). `platform:*` fica de fora de propósito: nunca é concedida ao papel
// Admin de um signup normal (ver TenantsService.create), então não conta como "tudo".
let ALL_KEYS: string[];
const MANAGEMENT = ['users:manage', 'roles:manage', 'tenant:manage'];

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Regras de conta (e2e)', () => {
  let ctx: TestApp;
  const tenantIds: string[] = [];

  const usersUrl = (t: TestTenant, suffix = '') => `/tenants/${t.tenantId}/users${suffix}`;
  const rolesUrl = (t: TestTenant, suffix = '') => `/tenants/${t.tenantId}/roles${suffix}`;

  const makeRole = async (t: TestTenant, name: string, keys: string[]) => {
    const res = await ctx
      .http()
      .post(rolesUrl(t))
      .set(t.auth)
      .send({ name: `${name} ${uniq()}`, permissionIds: await permissionIds(ctx.prisma, keys) })
      .expect(201);
    return res.body.id as string;
  };

  const newTenant = async (label: string) => {
    const t = await signupTenant(ctx.http, label);
    tenantIds.push(t.tenantId);
    return t;
  };

  const userRow = (id: string) => ctx.prisma.user.findUniqueOrThrow({ where: { id } });

  // Usuários ativos cujo papel tem as três permissões de administração.
  const activeAdmins = (t: TestTenant) =>
    ctx.prisma.user.count({
      where: {
        tenantId: t.tenantId,
        status: 'active',
        AND: MANAGEMENT.map((key) => ({
          role: { permissions: { some: { permission: { key } } } },
        })),
      },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    const permissions = await ctx.prisma.permission.findMany({ select: { key: true } });
    ALL_KEYS = permissions.map((p) => p.key).filter((key) => !key.startsWith('platform:'));
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, tenantIds);
    await ctx.app.close();
  });

  describe('sem escalada de privilégio', () => {
    let a: TestTenant;
    let recepRole: string;
    let userMgrRole: string;
    let roleMgrRole: string;
    let mgr: TestUser; // users:manage + patients:read
    let rmgr: TestUser; // roles:manage + patients:read
    let recep: TestUser;

    beforeAll(async () => {
      a = await newTenant('esc');
      recepRole = await makeRole(a, 'Recepcao', ['patients:read']);
      userMgrRole = await makeRole(a, 'GestorUsuarios', ['users:manage', 'patients:read']);
      roleMgrRole = await makeRole(a, 'GestorPapeis', ['roles:manage', 'patients:read']);
      mgr = await createUser(ctx.http, a, 'mgr', { roleId: userMgrRole });
      rmgr = await createUser(ctx.http, a, 'rmgr', { roleId: roleMgrRole });
      recep = await createUser(ctx.http, a, 'recep', { roleId: recepRole });
    });

    describe('usuários', () => {
      it('não cria usuário com papel que tem permissões que o ator não possui', async () => {
        const email = `promovido-${uniq()}@teste.com`;

        const res = await ctx
          .http()
          .post(usersUrl(a))
          .set(mgr.auth)
          .send({ name: 'Promovido', email, password: PASSWORD, roleId: a.roleId })
          .expect(403);

        expect(res.body.message).toMatch(/não pode conceder/);
        expect(res.body.message).toMatch(/roles:manage/);
        expect(await ctx.prisma.user.count({ where: { email } })).toBe(0);
      });

      it('cria usuário com papel dentro das próprias permissões', async () => {
        await createUser(ctx.http, a, 'ok-recep', { roleId: recepRole }); // pelo admin
        await ctx
          .http()
          .post(usersUrl(a))
          .set(mgr.auth)
          .send({ name: 'Novo', email: `novo-${uniq()}@teste.com`, password: PASSWORD, roleId: recepRole })
          .expect(201);
      });

      it('não se promove nem promove outro para um papel acima do próprio', async () => {
        await ctx.http().patch(usersUrl(a, `/${mgr.id}`)).set(mgr.auth).send({ roleId: a.roleId }).expect(403);
        await ctx.http().patch(usersUrl(a, `/${recep.id}`)).set(mgr.auth).send({ roleId: a.roleId }).expect(403);

        expect((await userRow(mgr.id)).roleId).toBe(userMgrRole);
        expect((await userRow(recep.id)).roleId).toBe(recepRole);
      });

      it('move usuário entre papéis que estão dentro das próprias permissões', async () => {
        const target = await createUser(ctx.http, a, 'mover', { roleId: recepRole });

        await ctx.http().patch(usersUrl(a, `/${target.id}`)).set(mgr.auth).send({ roleId: userMgrRole }).expect(200);

        expect((await userRow(target.id)).roleId).toBe(userMgrRole);
      });

      it('não altera um usuário acima de si (nem nome, nem status)', async () => {
        await ctx.http().patch(usersUrl(a, `/${a.id}`)).set(mgr.auth).send({ name: 'Sequestrado' }).expect(403);
        await ctx.http().patch(usersUrl(a, `/${a.id}`)).set(mgr.auth).send({ status: 'disabled' }).expect(403);

        const owner = await userRow(a.id);
        expect(owner.status).toBe('active');
        expect(owner.name).not.toBe('Sequestrado');
        await loginAs(ctx.http, a.email); // continua conseguindo entrar
      });

      it('edita a si mesmo e pode se rebaixar', async () => {
        const self = await createUser(ctx.http, a, 'self', { roleId: userMgrRole });

        await ctx.http().patch(usersUrl(a, `/${self.id}`)).set(self.auth).send({ name: 'Renomeado' }).expect(200);
        await ctx.http().patch(usersUrl(a, `/${self.id}`)).set(self.auth).send({ roleId: recepRole }).expect(200);

        expect((await userRow(self.id)).roleId).toBe(recepRole);
        // Perdeu users:manage na hora.
        await ctx.http().get(usersUrl(a)).set(self.auth).expect(403);
      });

      it('o administrador continua podendo atribuir qualquer papel', async () => {
        const target = await createUser(ctx.http, a, 'promocao', { roleId: recepRole });

        await ctx.http().patch(usersUrl(a, `/${target.id}`)).set(a.auth).send({ roleId: a.roleId }).expect(200);
        await ctx
          .http()
          .post(usersUrl(a))
          .set(a.auth)
          .send({ name: 'Outro Admin', email: `adm-${uniq()}@teste.com`, password: PASSWORD, roleId: a.roleId })
          .expect(201);
      });

      it('grava o email em minúsculas na edição e o usuário continua conseguindo logar', async () => {
        const target = await createUser(ctx.http, a, 'email-case', { roleId: recepRole });
        const newEmail = `Misto-${uniq()}@Teste.COM`;

        const res = await ctx.http().patch(usersUrl(a, `/${target.id}`)).set(a.auth).send({ email: newEmail }).expect(200);

        expect(res.body.email).toBe(newEmail.toLowerCase());
        await ctx.http().post('/auth/login').send({ email: newEmail, password: PASSWORD }).expect(200);
      });

      it('404 para usuário inexistente ou de outro tenant', async () => {
        await ctx.http().patch(usersUrl(a, `/${randomUUID()}`)).set(a.auth).send({ name: 'x' }).expect(404);
      });
    });

    describe('papéis', () => {
      it('não cria papel com permissões que o ator não possui', async () => {
        await ctx
          .http()
          .post(rolesUrl(a))
          .set(rmgr.auth)
          .send({ name: `Ambicioso ${uniq()}`, permissionIds: await permissionIds(ctx.prisma, ['patients:read', 'users:manage']) })
          .expect(403);
      });

      it('cria papel dentro das próprias permissões e recusa permissão inexistente (400)', async () => {
        await ctx
          .http()
          .post(rolesUrl(a))
          .set(rmgr.auth)
          .send({ name: `Modesto ${uniq()}`, permissionIds: await permissionIds(ctx.prisma, ['patients:read']) })
          .expect(201);
        await ctx
          .http()
          .post(rolesUrl(a))
          .set(rmgr.auth)
          .send({ name: `Fantasma ${uniq()}`, permissionIds: [randomUUID()] })
          .expect(400);
      });

      it('não concede a um papel permissões que não possui, nem no próprio papel', async () => {
        const usersManage = await permissionIds(ctx.prisma, ['users:manage']);

        // Adicionar users:manage ao papel da recepção...
        await ctx.http().patch(rolesUrl(a, `/${recepRole}`)).set(rmgr.auth).send({ permissionIds: usersManage }).expect(403);
        // ...ou ao próprio papel do ator (auto-promoção).
        await ctx
          .http()
          .patch(rolesUrl(a, `/${roleMgrRole}`))
          .set(rmgr.auth)
          .send({ permissionIds: await permissionIds(ctx.prisma, ['roles:manage', 'users:manage']) })
          .expect(403);

        const keys = (await ctx.prisma.rolePermission.findMany({
          where: { roleId: roleMgrRole },
          include: { permission: true },
        })).map((rp) => rp.permission.key).sort();
        expect(keys).toEqual(['patients:read', 'roles:manage']);
      });

      it('edita papel que está dentro das próprias permissões', async () => {
        await ctx
          .http()
          .patch(rolesUrl(a, `/${recepRole}`))
          .set(rmgr.auth)
          .send({ name: `Recepcao v2 ${uniq()}`, permissionIds: await permissionIds(ctx.prisma, ['patients:read']) })
          .expect(200);
      });

      it('não edita nem apaga papel acima de si (nem renomear)', async () => {
        for (const roleId of [userMgrRole, a.roleId]) {
          await ctx.http().patch(rolesUrl(a, `/${roleId}`)).set(rmgr.auth).send({ name: 'Renomeado' }).expect(403);
          await ctx.http().patch(rolesUrl(a, `/${roleId}`)).set(rmgr.auth).send({ permissionIds: [] }).expect(403);
          await ctx.http().delete(rolesUrl(a, `/${roleId}`)).set(rmgr.auth).expect(403);
        }

        const admin = await ctx.prisma.role.findUniqueOrThrow({
          where: { id: a.roleId },
          include: { permissions: true },
        });
        expect(admin.name).toBe('Admin');
        expect(admin.permissions).toHaveLength(ALL_KEYS.length);
      });

      it('apaga papel livre que está dentro das próprias permissões', async () => {
        const free = await ctx
          .http()
          .post(rolesUrl(a))
          .set(rmgr.auth)
          .send({ name: `Descartavel ${uniq()}`, permissionIds: await permissionIds(ctx.prisma, ['patients:read']) })
          .expect(201);

        await ctx.http().delete(rolesUrl(a, `/${free.body.id}`)).set(rmgr.auth).expect(200);
      });

      it('404 para papel inexistente', async () => {
        await ctx.http().patch(rolesUrl(a, `/${randomUUID()}`)).set(a.auth).send({ name: 'x' }).expect(404);
        await ctx.http().delete(rolesUrl(a, `/${randomUUID()}`)).set(a.auth).expect(404);
      });
    });
  });

  describe('último administrador', () => {
    let l: TestTenant;
    let recepRole: string;

    beforeAll(async () => {
      l = await newTenant('last');
      recepRole = await makeRole(l, 'Recepcao', ['patients:read']);
    });

    it('o único administrador não pode se desativar, nem virar não-ativo, nem trocar para papel sem acesso', async () => {
      for (const body of [{ status: 'disabled' }, { status: 'invited' }, { roleId: recepRole }]) {
        const res = await ctx.http().patch(usersUrl(l, `/${l.id}`)).set(l.auth).send(body).expect(409);
        expect(res.body.message).toMatch(/administrador/);
      }

      const owner = await userRow(l.id);
      expect(owner).toMatchObject({ status: 'active', roleId: l.roleId });
      await loginAs(ctx.http, l.email);
    });

    it('não permite tirar de todos o acesso administrativo pelo papel Admin', async () => {
      const withoutTenantManage = await permissionIds(ctx.prisma, ALL_KEYS.filter((k) => k !== 'tenant:manage'));

      await ctx.http().patch(rolesUrl(l, `/${l.roleId}`)).set(l.auth).send({ permissionIds: withoutTenantManage }).expect(409);
      await ctx.http().patch(rolesUrl(l, `/${l.roleId}`)).set(l.auth).send({ permissionIds: [] }).expect(409);

      const role = await ctx.prisma.role.findUniqueOrThrow({ where: { id: l.roleId }, include: { permissions: true } });
      expect(role.permissions).toHaveLength(ALL_KEYS.length);
    });

    it('mudanças que preservam o acesso passam (reenviar as permissões, renomear)', async () => {
      await ctx
        .http()
        .patch(rolesUrl(l, `/${l.roleId}`))
        .set(l.auth)
        .send({ permissionIds: await permissionIds(ctx.prisma, ALL_KEYS) })
        .expect(200);
      await ctx.http().patch(rolesUrl(l, `/${l.roleId}`)).set(l.auth).send({ description: 'Acesso total' }).expect(200);
    });

    it('usuário desativado não conta como administrador', async () => {
      const spare = await createUser(ctx.http, l, 'spare', { roleId: l.roleId });
      await ctx.http().patch(usersUrl(l, `/${spare.id}`)).set(l.auth).send({ status: 'disabled' }).expect(200);

      // O dono voltou a ser o único ativo.
      await ctx.http().patch(usersUrl(l, `/${l.id}`)).set(l.auth).send({ status: 'disabled' }).expect(409);
    });

    it('com um segundo administrador ativo, cada um pode ser desativado, mas nunca o último', async () => {
      const second = await createUser(ctx.http, l, 'second', { roleId: l.roleId });
      expect(await activeAdmins(l)).toBe(2);

      // O segundo desativa o dono (sobra ele)...
      await ctx.http().patch(usersUrl(l, `/${l.id}`)).set(second.auth).send({ status: 'disabled' }).expect(200);
      expect(await activeAdmins(l)).toBe(1);
      await ctx.http().post('/auth/login').send({ email: l.email, password: PASSWORD }).expect(401);

      // ...e agora ele é o último: não pode se desativar nem se rebaixar.
      await ctx.http().patch(usersUrl(l, `/${second.id}`)).set(second.auth).send({ status: 'disabled' }).expect(409);
      await ctx.http().patch(usersUrl(l, `/${second.id}`)).set(second.auth).send({ roleId: recepRole }).expect(409);
      expect(await activeAdmins(l)).toBe(1);

      // Reativar o dono devolve a folga.
      await ctx.http().patch(usersUrl(l, `/${l.id}`)).set(second.auth).send({ status: 'active' }).expect(200);
      expect(await activeAdmins(l)).toBe(2);
    });

    it('administrador é definido pelas permissões, não pelo nome do papel', async () => {
      const g = await newTenant('perm');
      // Papel com nome qualquer, mas com as 3 permissões de gestão: conta como administrador.
      const gestao = await makeRole(g, 'Gestao', MANAGEMENT);
      const other = await createUser(ctx.http, g, 'gestao', { roleId: gestao });
      expect(await activeAdmins(g)).toBe(2);

      // O dono ("Admin") pode se desativar, pois "other" garante um administrador ativo...
      await ctx.http().patch(usersUrl(g, `/${g.id}`)).set(g.auth).send({ status: 'disabled' }).expect(200);

      // ...e agora "other" é o último: não pode se desativar.
      await ctx.http().patch(usersUrl(g, `/${other.id}`)).set(other.auth).send({ status: 'disabled' }).expect(409);
      expect(await activeAdmins(g)).toBe(1);
    });
  });

  // Sem o lock por tenant, dois admins que se desativam ao mesmo tempo enxergam o outro
  // ainda ativo e ambos passam: o tenant ficaria sem administrador.
  describe('concorrência entre administradores', () => {
    it('dois admins tentando se desativar ao mesmo tempo nunca zeram os administradores', async () => {
      const c = await newTenant('race');
      const other = await createUser(ctx.http, c, 'race-b', { roleId: c.roleId });
      let raced = 0;

      for (let round = 0; round < 8; round++) {
        await ctx.prisma.user.updateMany({ where: { tenantId: c.tenantId }, data: { status: 'active' } });

        const [r1, r2] = await Promise.all([
          ctx.http().patch(usersUrl(c, `/${other.id}`)).set(c.auth).send({ status: 'disabled' }),
          ctx.http().patch(usersUrl(c, `/${c.id}`)).set(other.auth).send({ status: 'disabled' }),
        ]);

        // Um perde: 409 (barrado pela regra) ou 401 (já desativado quando a requisição chegou).
        expect([r1.status, r2.status].filter((s) => s === 200).length).toBeLessThanOrEqual(1);
        expect(await activeAdmins(c)).toBeGreaterThanOrEqual(1);
        raced += [r1.status, r2.status].filter((s) => s === 409).length;
      }

      // Pelo menos uma rodada precisa ter chegado à regra (409), senão o teste não exercitou a corrida.
      expect(raced).toBeGreaterThan(0);
    });

    it('dois admins se rebaixando ao mesmo tempo também respeitam a regra', async () => {
      const c = await newTenant('race2');
      const other = await createUser(ctx.http, c, 'race2-b', { roleId: c.roleId });
      const recepRole = await makeRole(c, 'Recepcao', ['patients:read']);

      for (let round = 0; round < 8; round++) {
        await ctx.prisma.user.updateMany({ where: { tenantId: c.tenantId }, data: { status: 'active', roleId: c.roleId } });

        await Promise.all([
          ctx.http().patch(usersUrl(c, `/${other.id}`)).set(c.auth).send({ roleId: recepRole }),
          ctx.http().patch(usersUrl(c, `/${c.id}`)).set(other.auth).send({ roleId: recepRole }),
        ]);

        expect(await activeAdmins(c)).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
