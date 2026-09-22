import {
  cleanupTenants,
  createTestApp,
  createUser,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

interface Listed {
  id: string;
  name: string;
}

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Usuários e papéis: paginação (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('usuários', () => {
    let a: TestTenant;
    let o: TestTenant;
    const usersUrl = (t: TestTenant) => `/tenants/${t.tenantId}/users`;
    const list = (t: TestTenant, query: Record<string, string | number> = {}) =>
      ctx.http().get(usersUrl(t)).query(query).set(t.auth);
    // 24 profissionais + o dono = 25. Sem espaço: o nome também vira parte do email de teste.
    const ordered = Array.from({ length: 24 }, (_, i) => `Prof${String.fromCharCode(65 + i)}`);

    beforeAll(async () => {
      a = await signupTenant(ctx.http, 'up-a');
      o = await signupTenant(ctx.http, 'up-o');
      // Fora de ordem, para provar que a ordenação é do banco e não da inserção.
      for (const name of [...ordered].reverse()) {
        await createUser(ctx.http, a, name);
      }
      // 24x (criar + logar), cada um com bcrypt (SALT_ROUNDS=12, deliberadamente caro): passa
      // do timeout padrão de hook (10s) mesmo sem nada de errado, daí o prazo maior aqui.
    }, 30_000);

    afterAll(async () => {
      await cleanupTenants(ctx.prisma, [a?.tenantId, o?.tenantId]);
    });

    it('usa página de 20 por padrão e informa o total (24 profissionais + o dono)', async () => {
      const res = await list(a).expect(200);

      expect(res.body.data).toHaveLength(20);
      expect(res.body.meta).toEqual({ total: 25, page: 1, pageSize: 20, totalPages: 2 });
    });

    it('nunca devolve a senha, nem paginado', async () => {
      const res = await list(a).expect(200);
      expect(res.body.data.every((u: Record<string, unknown>) => !('passwordHash' in u))).toBe(true);
    });

    it('a ordem é por nome; o dono ("Dono up-a") vem antes dos "Prof *"', async () => {
      const res = await list(a, { pageSize: 100 }).expect(200);
      const names = (res.body.data as Listed[]).map((u) => u.name);

      expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
      expect(names[0]).toMatch(/^Dono/);
    });

    it('páginas sucessivas cobrem tudo, sem repetir nem pular', async () => {
      const seen: Listed[] = [];
      for (const page of [1, 2, 3]) {
        const res = await list(a, { page, pageSize: 10 }).expect(200);
        expect(res.body.meta).toEqual({ total: 25, page, pageSize: 10, totalPages: 3 });
        seen.push(...res.body.data);
      }

      expect(seen).toHaveLength(25);
      expect(new Set(seen.map((x) => x.id)).size).toBe(25);
    });

    it('nomes duplicados têm ordem estável entre as páginas (desempate por id)', async () => {
      const dup1 = await createUser(ctx.http, a, 'ZzzHomonimo');
      const dup2 = await createUser(ctx.http, a, 'ZzzHomonimo');
      const dup3 = await createUser(ctx.http, a, 'ZzzHomonimo');
      const dupIds = [dup1.id, dup2.id, dup3.id].sort();

      const walked: string[] = [];
      for (let page = 26; page <= 28; page++) {
        const res = await list(a, { page, pageSize: 1 }).expect(200);
        walked.push(res.body.data[0].id);
      }

      expect(walked).toEqual(dupIds);
      // Repetir a consulta dá a mesma ordem.
      const again: string[] = [];
      for (let page = 26; page <= 28; page++) {
        again.push((await list(a, { page, pageSize: 1 }).expect(200)).body.data[0].id);
      }
      expect(again).toEqual(walked);
    }, 10_000); // 3x (criar + logar) com bcrypt, mais 6 buscas: acima do padrão de 5s do teste.

    it('página além da última devolve lista vazia mas com o total certo', async () => {
      const res = await list(a, { page: 9, pageSize: 10 }).expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toEqual({ total: 28, page: 9, pageSize: 10, totalPages: 3 });
    });

    it('cada tenant só vê e conta os próprios usuários', async () => {
      const res = await list(o).expect(200);

      expect(res.body.meta.total).toBe(1); // só o dono
      expect((res.body.data as Listed[]).some((u) => ordered.includes(u.name))).toBe(false);
    });

    it.each([
      ['page=0', { page: 0 }],
      ['page negativa', { page: -1 }],
      ['page não numérica', { page: 'abc' }],
      ['page decimal', { page: 1.5 }],
      ['pageSize=0', { pageSize: 0 }],
      ['pageSize acima de 100', { pageSize: 101 }],
      ['parâmetro desconhecido', { orderBy: 'email' }],
    ])('recusa parâmetros inválidos: %s (400)', async (_name, query) => {
      await list(a, query).expect(400);
    });
  });

  describe('papéis', () => {
    let a: TestTenant;
    let o: TestTenant;
    const rolesUrl = (t: TestTenant) => `/tenants/${t.tenantId}/roles`;
    const list = (t: TestTenant, query: Record<string, string | number> = {}) =>
      ctx.http().get(rolesUrl(t)).query(query).set(t.auth);
    // Nomes únicos por tenant (constraint do Role): não dá pra testar empate por nome aqui,
    // só a ordem alfabética — o desempate por id já é coberto para usuários e agenda.
    const ordered = Array.from({ length: 24 }, (_, i) => `Papel ${String.fromCharCode(65 + i)}`);

    beforeAll(async () => {
      a = await signupTenant(ctx.http, 'rp-a');
      o = await signupTenant(ctx.http, 'rp-o');
      for (const name of [...ordered].reverse()) {
        await ctx.http().post(rolesUrl(a)).set(a.auth).send({ name }).expect(201);
      }
    });

    afterAll(async () => {
      await cleanupTenants(ctx.prisma, [a?.tenantId, o?.tenantId]);
    });

    it('usa página de 20 por padrão e informa o total (24 papéis + o "Admin" do signup)', async () => {
      const res = await list(a).expect(200);

      expect(res.body.data).toHaveLength(20);
      expect(res.body.meta).toEqual({ total: 25, page: 1, pageSize: 20, totalPages: 2 });
    });

    it('a ordem é alfabética; "Admin" vem antes de "Papel *"', async () => {
      const res = await list(a, { pageSize: 100 }).expect(200);
      const names = (res.body.data as Listed[]).map((r) => r.name);

      expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
      expect(names[0]).toBe('Admin');
    });

    it('cada papel continua vindo com as permissões (não só id/nome)', async () => {
      const res = await list(a, { pageSize: 1 }).expect(200);
      expect(res.body.data[0]).toHaveProperty('permissions');
    });

    it('páginas sucessivas cobrem tudo, sem repetir nem pular', async () => {
      const seen: Listed[] = [];
      for (const page of [1, 2, 3]) {
        const res = await list(a, { page, pageSize: 10 }).expect(200);
        expect(res.body.meta).toEqual({ total: 25, page, pageSize: 10, totalPages: 3 });
        seen.push(...res.body.data);
      }

      expect(seen).toHaveLength(25);
      expect(new Set(seen.map((x) => x.id)).size).toBe(25);
      expect(seen.map((x) => x.name)).toEqual(['Admin', ...ordered]);
    });

    it('página além da última devolve lista vazia mas com o total certo', async () => {
      const res = await list(a, { page: 9, pageSize: 10 }).expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toEqual({ total: 25, page: 9, pageSize: 10, totalPages: 3 });
    });

    it('cada tenant só vê e conta os próprios papéis', async () => {
      const res = await list(o).expect(200);

      expect(res.body.meta.total).toBe(1); // só o "Admin" do próprio signup
      expect((res.body.data as Listed[]).some((r) => ordered.includes(r.name))).toBe(false);
    });

    it.each([
      ['page=0', { page: 0 }],
      ['page negativa', { page: -1 }],
      ['page não numérica', { page: 'abc' }],
      ['pageSize acima de 100', { pageSize: 101 }],
      ['parâmetro desconhecido', { q: uniq() }],
    ])('recusa parâmetros inválidos: %s (400)', async (_name, query) => {
      await list(a, query).expect(400);
    });
  });
});
