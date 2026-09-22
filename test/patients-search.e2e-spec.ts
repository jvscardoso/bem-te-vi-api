import {
  cleanupTenants,
  createPatient,
  createTestApp,
  signupTenant,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

interface Listed {
  id: string;
  fullName: string;
}

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
// A busca depende da extensão unaccent, criada pela migration patient_search.
describe('Pacientes: busca e paginação (e2e)', () => {
  let ctx: TestApp;
  let s: TestTenant; // dados da busca
  let p: TestTenant; // paginação
  let o: TestTenant; // outro tenant (isolamento)

  const listUrl = (t: TestTenant) => `/tenants/${t.tenantId}/patients`;
  const removedUrl = (t: TestTenant) => `${listUrl(t)}/removed`;
  const list = (t: TestTenant, query: Record<string, string | number> = {}) =>
    ctx.http().get(listUrl(t)).query(query).set(t.auth);
  const names = (body: { data: Listed[] }) => body.data.map((x) => x.fullName);
  const search = async (q: string, t = s) => names((await list(t, { q }).expect(200)).body);

  // Nomes e CPFs escolhidos para exercitar acento, sobrenome, ordem e CPF parcial.
  const SEARCH_SET = [
    { fullName: 'Maria da Silva', cpf: '12345678901' },
    { fullName: 'João Pedro Souza', cpf: '98765432100' },
    { fullName: 'Joana Silva Santos', cpf: '11122233344' },
    { fullName: 'José Carlos de Oliveira', cpf: '55566677788' },
    { fullName: 'Ana Paula Lima' },
    { fullName: 'Conceição Aparecida', cpf: '12399988877' },
    { fullName: 'Maria Eduarda Costa', cpf: '32165498700' },
    { fullName: 'Fulano_100% Teste' },
  ];

  beforeAll(async () => {
    ctx = await createTestApp();
    s = await signupTenant(ctx.http, 'bs');
    p = await signupTenant(ctx.http, 'bp');
    o = await signupTenant(ctx.http, 'bo');
    for (const patient of SEARCH_SET) {
      await createPatient(ctx.http, s, patient);
    }
    // Removido: some da busca normal, mas aparece na de removidos.
    const removed = await createPatient(ctx.http, s, { fullName: 'Maria Removida', cpf: '77788899900' });
    await ctx.http().delete(`${listUrl(s)}/${removed.id}`).set(s.auth).expect(200);
    // Mesma pessoa/CPF em outro tenant: não pode aparecer na busca do primeiro.
    await createPatient(ctx.http, o, { fullName: 'Maria da Silva Outra Clinica', cpf: '12345678901' });
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [s?.tenantId, p?.tenantId, o?.tenantId]);
    await ctx.app.close();
  });

  describe('busca por nome', () => {
    it('sem q lista os pacientes ativos em ordem alfabética (removidos ficam de fora)', async () => {
      const res = await list(s).expect(200);

      expect(names(res.body)).toEqual([
        'Ana Paula Lima',
        'Conceição Aparecida',
        'Fulano_100% Teste',
        'Joana Silva Santos',
        'João Pedro Souza',
        'José Carlos de Oliveira',
        'Maria da Silva',
        'Maria Eduarda Costa',
      ]);
      expect(res.body.meta.total).toBe(8);
    });

    it('encontra por nome, sem diferenciar maiúsculas', async () => {
      expect(await search('maria')).toEqual(['Maria da Silva', 'Maria Eduarda Costa']);
      expect(await search('MARIA')).toEqual(['Maria da Silva', 'Maria Eduarda Costa']);
    });

    it('encontra por sobrenome', async () => {
      expect(await search('silva')).toEqual(['Joana Silva Santos', 'Maria da Silva']);
    });

    it('nome + sobrenome, em qualquer ordem e com palavras parciais', async () => {
      expect(await search('maria silva')).toEqual(['Maria da Silva']);
      expect(await search('silva maria')).toEqual(['Maria da Silva']);
      expect(await search('joana santos')).toEqual(['Joana Silva Santos']);
      expect(await search('mar sil')).toEqual(['Maria da Silva']);
      expect(await search('  maria    eduarda  ')).toEqual(['Maria Eduarda Costa']);
    });

    it('não diferencia acentos, digitando com ou sem eles', async () => {
      expect(await search('joao')).toEqual(['João Pedro Souza']);
      expect(await search('JOÃO')).toEqual(['João Pedro Souza']);
      expect(await search('jose')).toEqual(['José Carlos de Oliveira']);
      expect(await search('conceicao')).toEqual(['Conceição Aparecida']);
      expect(await search('conceição')).toEqual(['Conceição Aparecida']);
    });

    it('sem resultado devolve lista vazia (não erro)', async () => {
      const res = await list(s, { q: 'inexistente' }).expect(200);
      expect(res.body).toEqual({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } });
    });
  });

  describe('busca por CPF', () => {
    it('CPF completo, com ou sem pontuação', async () => {
      expect(await search('123.456.789-01')).toEqual(['Maria da Silva']);
      expect(await search('12345678901')).toEqual(['Maria da Silva']);
    });

    it('CPF parcial, com ou sem pontuação', async () => {
      expect(await search('123456')).toEqual(['Maria da Silva']);
      expect(await search('123.456')).toEqual(['Maria da Silva']);
      expect(await search('123')).toEqual(['Conceição Aparecida', 'Maria da Silva']);
    });

    it('combina nome e CPF: todas as palavras precisam casar', async () => {
      expect(await search('maria 1234')).toEqual(['Maria da Silva']);
      expect(await search('maria 321')).toEqual(['Maria Eduarda Costa']);
      expect(await search('joao 12345678901')).toEqual([]);
    });

    it('não encontra CPF de paciente removido na busca normal, mas sim na de removidos', async () => {
      expect(await search('777888')).toEqual([]);

      const res = await ctx.http().get(removedUrl(s)).query({ q: '777.888' }).set(s.auth).expect(200);
      expect(names(res.body)).toEqual(['Maria Removida']);
    });
  });

  describe('entrada maliciosa ou estranha', () => {
    it('curingas do LIKE valem como texto literal', async () => {
      expect(await search('%')).toEqual(['Fulano_100% Teste']);
      expect(await search('_')).toEqual(['Fulano_100% Teste']);
      expect(await search('100%')).toEqual(['Fulano_100% Teste']);
      expect(await search('%%')).toEqual([]);
      expect(await search('\\')).toEqual([]);
    });

    it('SQL na busca é só texto: não quebra nem altera nada', async () => {
      const before = await ctx.prisma.patient.count();

      for (const q of ["'; DROP TABLE patients; --", "x' OR '1'='1", '") OR TRUE --', 'a\u0000b']) {
        const res = await list(s, { q }).set(s.auth);
        expect([200, 400]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body.data).toEqual([]);
        }
      }
      expect(await ctx.prisma.patient.count()).toBe(before);
    });
  });

  describe('isolamento entre tenants', () => {
    it('a busca só enxerga o próprio tenant, mesmo com o mesmo nome e CPF', async () => {
      expect(await search('12345678901')).toEqual(['Maria da Silva']);
      expect(await search('12345678901', o)).toEqual(['Maria da Silva Outra Clinica']);
      expect(await search('outra clinica')).toEqual([]);
    });

    it('a URL de outro tenant continua sendo 403', async () => {
      await list(s).set(o.auth).expect(403);
      await ctx.http().get(removedUrl(s)).set(o.auth).expect(403);
    });
  });

  describe('paginação', () => {
    // 25 pacientes com nomes que ordenam de A a Y, mais 3 homônimos para o desempate.
    const LETTERS = Array.from({ length: 25 }, (_, i) => String.fromCharCode(65 + i));
    const ordered = LETTERS.map((letter) => `Paciente Letra ${letter}`);

    beforeAll(async () => {
      // Fora de ordem, para provar que a ordenação é do banco e não da inserção.
      for (const name of [...ordered].reverse()) {
        await createPatient(ctx.http, p, { fullName: name });
      }
      for (let i = 0; i < 3; i++) {
        await createPatient(ctx.http, p, { fullName: 'Homonimo Igual' });
      }
    });

    it('usa página de 20 por padrão e informa o total', async () => {
      const res = await list(p).expect(200);

      expect(res.body.data).toHaveLength(20);
      expect(res.body.meta).toEqual({ total: 28, page: 1, pageSize: 20, totalPages: 2 });
    });

    it('pages sucessivas cobrem tudo, sem repetir nem pular', async () => {
      const seen: Listed[] = [];
      for (const page of [1, 2, 3]) {
        const res = await list(p, { page, pageSize: 10 }).expect(200);
        expect(res.body.meta).toEqual({ total: 28, page, pageSize: 10, totalPages: 3 });
        seen.push(...res.body.data);
      }

      expect(seen).toHaveLength(28);
      expect(new Set(seen.map((x) => x.id)).size).toBe(28);
      expect(seen.map((x) => x.fullName)).toEqual([...ordered, 'Homonimo Igual', 'Homonimo Igual', 'Homonimo Igual']
        .sort((x, y) => (x === y ? 0 : x < y ? -1 : 1)));
    });

    it('homônimos têm ordem estável entre as páginas (desempate por id)', async () => {
      const ids: string[] = [];
      const search = { q: 'homonimo', pageSize: 1 };
      for (const page of [1, 2, 3]) {
        const res = await list(p, { ...search, page }).expect(200);
        ids.push(res.body.data[0].id);
      }

      expect(new Set(ids).size).toBe(3);
      const again = [];
      for (const page of [1, 2, 3]) {
        again.push((await list(p, { ...search, page }).expect(200)).body.data[0].id);
      }
      expect(again).toEqual(ids);
    });

    it('página além da última devolve lista vazia mas com o total certo', async () => {
      const res = await list(p, { page: 9 }).expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toEqual({ total: 28, page: 9, pageSize: 20, totalPages: 2 });
    });

    it('combina busca e paginação', async () => {
      const first = await list(p, { q: 'paciente letra', pageSize: 10, page: 1 }).expect(200);
      const last = await list(p, { q: 'paciente letra', pageSize: 10, page: 3 }).expect(200);

      expect(first.body.meta).toEqual({ total: 25, page: 1, pageSize: 10, totalPages: 3 });
      expect(names(first.body)).toEqual(ordered.slice(0, 10));
      expect(names(last.body)).toEqual(ordered.slice(20));
    });

    it('aceita pageSize até 100', async () => {
      const res = await list(p, { pageSize: 100 }).expect(200);
      expect(res.body.data).toHaveLength(28);
      expect(res.body.meta.totalPages).toBe(1);
    });

    it('a listagem de removidos também é paginada e pesquisável', async () => {
      const removedIds: string[] = [];
      for (const name of ['Sumido Um', 'Sumido Dois', 'Sumido Tres']) {
        const patient = await createPatient(ctx.http, p, { fullName: name });
        await ctx.http().delete(`${listUrl(p)}/${patient.id}`).set(p.auth).expect(200);
        removedIds.push(patient.id);
      }

      const firstPage = await ctx.http().get(removedUrl(p)).query({ pageSize: 2 }).set(p.auth).expect(200);
      expect(firstPage.body.meta).toEqual({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
      // Mais recente removido primeiro.
      expect(firstPage.body.data.map((x: Listed) => x.id)).toEqual([removedIds[2], removedIds[1]]);

      const found = await ctx.http().get(removedUrl(p)).query({ q: 'dois' }).set(p.auth).expect(200);
      expect(names(found.body)).toEqual(['Sumido Dois']);
    });

    it.each([
      ['page=0', { page: 0 }],
      ['page negativa', { page: -1 }],
      ['page não numérica', { page: 'abc' }],
      ['page decimal', { page: 1.5 }],
      ['page absurda', { page: 1_000_000 }],
      ['pageSize=0', { pageSize: 0 }],
      ['pageSize acima de 100', { pageSize: 101 }],
      ['pageSize decimal', { pageSize: 2.5 }],
      ['q longo demais', { q: 'a'.repeat(101) }],
      ['parâmetro desconhecido', { orderBy: 'cpf' }],
    ])('recusa parâmetros inválidos: %s (400)', async (_name, query) => {
      await list(p, query).expect(400);
      await ctx.http().get(removedUrl(p)).query(query).set(p.auth).expect(400);
    });
  });
});
