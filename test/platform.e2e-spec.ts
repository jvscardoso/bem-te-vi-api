import { randomUUID } from 'node:crypto';
import {
  PASSWORD,
  cleanupTenants,
  createPatient,
  createPlatformAdmin,
  createTestApp,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed, que cria a
// permissão `platform:manage`).
describe('Backoffice da plataforma (e2e)', () => {
  let ctx: TestApp;
  let platform: TestTenant;
  const managedTenantIds: string[] = [];

  const listUrl = (query: Record<string, string | number> = {}) =>
    ctx.http().get('/platform/tenants').query(query);
  const statusUrl = (id: string) => `/platform/tenants/${id}/status`;
  const newTenant = async (label: string) => {
    const t = await signupTenant(ctx.http, label);
    managedTenantIds.push(t.tenantId);
    return t;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    platform = await createPlatformAdmin(ctx);
  });

  afterAll(async () => {
    // O tenant da própria plataforma (criado por createPlatformAdmin) também precisa ser
    // limpo — não é uma clínica "gerenciada" pelas rotas testadas, mas é uma linha real no
    // banco, senão cada execução da suíte deixa uma "plataforma" órfã para trás.
    await cleanupTenants(ctx.prisma, [...managedTenantIds, platform?.tenantId]);
    await ctx.app.close();
  });

  describe('acesso', () => {
    it('sem token é 401; token de clínica normal é 403', async () => {
      const clinic = await newTenant('acc-normal');

      await listUrl().expect(401);
      await listUrl().set(clinic.auth).expect(403);
      await ctx.http().patch(statusUrl(clinic.tenantId)).set(clinic.auth).send({ status: 'suspended' }).expect(403);
    });

    it('CRÍTICO: signup público nunca ganha platform:manage', async () => {
      const clinic = await newTenant('sem-platform');
      const login = await ctx.http().post('/auth/login').send({ email: clinic.email, password: PASSWORD }).expect(200);

      expect(login.body.user.permissions).not.toContain('platform:manage');
    });

    it('admin da plataforma não acessa dados de negócio de uma clínica (isolamento intacto)', async () => {
      const clinic = await newTenant('isolada');

      // Mesmo com platform:manage, TenantAccessGuard continua barrando qualquer :tenantId
      // que não seja o do próprio token — o backoffice não abre uma porta para prontuário.
      await ctx.http().get(`/tenants/${clinic.tenantId}/patients`).set(platform.auth).expect(403);
    });
  });

  describe('listagem', () => {
    it('lista as clínicas paginadas, com contagem de usuários e pacientes', async () => {
      const a = await newTenant('list-a');
      const b = await newTenant('list-b');
      await createPatient(ctx.http, a);
      await createPatient(ctx.http, a);

      const res = await listUrl({ pageSize: 100 }).set(platform.auth).expect(200);
      interface Listed {
        id: string;
        name: string;
        status: string;
        _count: { users: number; patients: number };
      }
      const byId = Object.fromEntries((res.body.data as Listed[]).map((t) => [t.id, t]));

      expect(byId[a.tenantId]).toMatchObject({
        name: expect.stringContaining('list-a'),
        status: 'active',
        _count: { users: 1, patients: 2 },
      });
      expect(byId[b.tenantId]._count).toEqual({ users: 1, patients: 0 });
    });

    it('a própria clínica-plataforma nunca aparece na listagem', async () => {
      const res = await listUrl({ pageSize: 100 }).set(platform.auth).expect(200);

      expect(res.body.data.some((t: { id: string }) => t.id === platform.tenantId)).toBe(false);
      // O próprio token do backoffice não é o de um tenant "normal" listável.
      const names = (res.body.data as { name: string }[]).map((t) => t.name);
      expect(names.some((n) => n.startsWith('Plataforma'))).toBe(false);
    });

    it('não devolve campos sensíveis (nada de senha, nada de token de domínio)', async () => {
      const res = await listUrl({ pageSize: 1 }).set(platform.auth).expect(200);
      const raw = JSON.stringify(res.body.data[0]);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('customDomainVerificationToken');
    });

    it('paginação segue o mesmo contrato de pacientes/agenda/usuários', async () => {
      await listUrl({ page: 0 }).set(platform.auth).expect(400);
      await listUrl({ pageSize: 101 }).set(platform.auth).expect(400);
      await listUrl({ orderBy: 'name' }).set(platform.auth).expect(400);
    });
  });

  describe('busca', () => {
    // Cria uma clínica com nome/subdomínio/domínio próprio sob controle total do teste — os
    // helpers compartilhados (signupTenant) não servem aqui: eles geram nome/subdomínio a
    // partir do mesmo label, sem espaço para acento ou palavras independentes por campo.
    const createNamedTenant = async (
      name: string,
      subdomain: string,
      customDomain?: string,
    ): Promise<{ id: string; name: string }> => {
      const res = await ctx
        .http()
        .post('/tenants')
        .send({
          name,
          subdomain,
          ...(customDomain ? { customDomain } : {}),
          owner: { name: 'Dono', email: `dono-${uniq()}@teste.com`, password: PASSWORD },
        })
        .expect(201);
      managedTenantIds.push(res.body.tenant.id);
      return res.body.tenant;
    };
    const search = async (q: string) => {
      const res = await listUrl({ q, pageSize: 100 }).set(platform.auth).expect(200);
      return (res.body.data as { id: string; name: string }[]).map((t) => t.name);
    };

    it('busca por nome, sem diferenciar maiúsculas nem acentos', async () => {
      const tag = uniq();
      await createNamedTenant(`Clínica São João ${tag}`, `sj-${tag}`);

      expect(await search(`sao joao ${tag}`)).toEqual([`Clínica São João ${tag}`]);
      expect(await search(`SAO JOAO ${tag}`)).toEqual([`Clínica São João ${tag}`]);
    });

    it('busca por subdomínio, mesmo sem nenhuma palavra do nome bater', async () => {
      const tag = uniq();
      const tenant = await createNamedTenant(`Clinica Alfa ${tag}`, `buscavel-sub-${tag}`);

      expect(await search(`buscavel-sub-${tag}`)).toEqual([tenant.name]);
    });

    it('busca por domínio próprio', async () => {
      const tag = uniq();
      const tenant = await createNamedTenant(
        `Clinica Beta ${tag}`,
        `beta-${tag}`,
        `agenda-buscavel-${tag}.exemplo.com`,
      );

      expect(await search(`buscavel-${tag}`)).toEqual([tenant.name]);
    });

    it('várias palavras: todas precisam casar (em nome, subdomínio ou domínio, cada uma)', async () => {
      const tag = uniq();
      await createNamedTenant(`Clinica Gama Delta ${tag}`, `gd-${tag}`);

      expect(await search(`gama delta ${tag}`)).toEqual([`Clinica Gama Delta ${tag}`]);
      expect(await search(`gama inexistente-${tag}`)).toEqual([]);
    });

    it('sem resultado devolve lista vazia, não erro', async () => {
      expect(await search(`nao-existe-${uniq()}`)).toEqual([]);
    });

    it('curingas do LIKE (%, _) valem como texto literal, não como coringa de verdade', async () => {
      const tag = uniq();
      const withWildcardChars = await createNamedTenant(`Clinica 100% Especial_${tag} Pct`, `pct-${tag}`);
      // Um nome comum, sem % nem _, que um curinga "de verdade" bateria mas o literal não.
      await createNamedTenant(`Clinica Comum ${tag} Pct`, `comum-${tag}`);

      // Buscar só "%" (ou só "_") não pode devolver TODO MUNDO — só quem tem o caractere
      // literal no nome. Se o escape do LIKE falhar, "%" vira curinga e casa com qualquer coisa.
      expect(await search(`${tag} Pct %`)).toEqual([withWildcardChars.name]);
      expect(await search(`${tag} Pct _`)).toEqual([withWildcardChars.name]);

      // E a busca completa, com pontuação, ainda encontra o registro certo.
      expect(await search(`100% especial_${tag}`)).toEqual([withWildcardChars.name]);
    });

    it('texto malicioso na busca é só texto: não quebra nem altera nada', async () => {
      const before = await ctx.prisma.tenant.count();

      for (const q of ["'; DROP TABLE tenants; --", "x' OR '1'='1", '") OR TRUE --']) {
        const res = await listUrl({ q }).set(platform.auth);
        expect([200, 400]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body.data).toEqual([]);
        }
      }
      expect(await ctx.prisma.tenant.count()).toBe(before);
    });

    it('a clínica-plataforma nunca aparece na busca, nem pelo próprio nome', async () => {
      expect(await search('Plataforma')).toEqual([]);
    });

    it('busca combinada com paginação', async () => {
      const tag = uniq();
      const names = ['Um', 'Dois', 'Tres'].map((n) => `Clinica Paginada ${n} ${tag}`);
      for (const [i, name] of names.entries()) {
        await createNamedTenant(name, `pag-${i}-${tag}`);
      }

      const page1 = await listUrl({ q: `paginada ${tag}`, pageSize: 2, page: 1 }).set(platform.auth).expect(200);
      const page2 = await listUrl({ q: `paginada ${tag}`, pageSize: 2, page: 2 }).set(platform.auth).expect(200);

      expect(page1.body.meta).toEqual({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
      expect(page1.body.data).toHaveLength(2);
      expect(page2.body.data).toHaveLength(1);
    });

    it('q muito longo é recusado (400)', async () => {
      await listUrl({ q: 'a'.repeat(101) }).set(platform.auth).expect(400);
    });
  });

  describe('suspender e reativar', () => {
    it('suspende: o dono perde acesso na hora e não consegue mais logar', async () => {
      const clinic = await newTenant('susp');
      await ctx.http().get(`/tenants/${clinic.tenantId}/patients`).set(clinic.auth).expect(200);

      const res = await ctx
        .http()
        .patch(statusUrl(clinic.tenantId))
        .set(platform.auth)
        .send({ status: 'suspended' })
        .expect(200);
      expect(res.body).toMatchObject({ id: clinic.tenantId, status: 'suspended' });

      await ctx.http().post('/auth/login').send({ email: clinic.email, password: PASSWORD }).expect(401);
      await ctx.http().get(`/tenants/${clinic.tenantId}/patients`).set(clinic.auth).expect(401);
    });

    it('reativa: o dono volta a logar e a usar a clínica', async () => {
      const clinic = await newTenant('react');
      await ctx.http().patch(statusUrl(clinic.tenantId)).set(platform.auth).send({ status: 'suspended' }).expect(200);
      await ctx.http().post('/auth/login').send({ email: clinic.email, password: PASSWORD }).expect(401);

      await ctx.http().patch(statusUrl(clinic.tenantId)).set(platform.auth).send({ status: 'active' }).expect(200);

      await ctx.http().post('/auth/login').send({ email: clinic.email, password: PASSWORD }).expect(200);
    });

    it('a própria clínica do admin da plataforma não pode ser suspensa por aqui (404)', async () => {
      // "Não encontrado", não 403: o backoffice trata a si mesmo como se não existisse aqui.
      const res = await ctx
        .http()
        .patch(statusUrl(platform.tenantId))
        .set(platform.auth)
        .send({ status: 'suspended' })
        .expect(404);
      expect(res.body.message).toContain('não encontrado');
    });

    it('404 para tenant inexistente; 400 para status inválido', async () => {
      const clinic = await newTenant('valid');

      await ctx.http().patch(statusUrl(randomUUID())).set(platform.auth).send({ status: 'suspended' }).expect(404);
      await ctx.http().patch(statusUrl(clinic.tenantId)).set(platform.auth).send({ status: 'arquivado' }).expect(400);
      await ctx.http().patch(statusUrl(clinic.tenantId)).set(platform.auth).send({}).expect(400);
    });
  });
});
