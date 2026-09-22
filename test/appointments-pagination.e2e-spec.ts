import {
  cleanupTenants,
  createPatient,
  createTestApp,
  createUser,
  signupTenant,
  type TestApp,
  type TestTenant,
  type TestUser,
} from './helpers/e2e.js';

interface Listed {
  id: string;
  scheduledAt: string;
  tenantId: string;
  status: string;
}

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Agenda: paginação (e2e)', () => {
  let ctx: TestApp;
  let p: TestTenant;
  let o: TestTenant; // outro tenant
  let profA: TestUser;
  let profs: TestUser[]; // 5 profissionais (A + 4) para os empates de horário
  let patient: { id: string };

  const at = (day: number, hour: number, minute = 0) =>
    new Date(Date.UTC(2032, 0, day, hour, minute)).toISOString();
  const listUrl = (t: TestTenant) => `/tenants/${t.tenantId}/appointments`;
  const list = (t: TestTenant, query: Record<string, string | number> = {}) =>
    ctx.http().get(listUrl(t)).query(query).set(t.auth);
  const ids = (body: { data: Listed[] }) => body.data.map((x) => x.id);

  const book = async (t: TestTenant, patientId: string, professionalId: string, scheduledAt: string) =>
    (
      await ctx
        .http()
        .post(listUrl(t))
        .set(t.auth)
        .send({ patientId, professionalId, scheduledAt, endsAt: new Date(Date.parse(scheduledAt) + 30 * 60_000).toISOString() })
        .expect(201)
    ).body as Listed;

  // 25 agendamentos do profissional A (dias 1..25, 09:00) + 5 no mesmo horário exato
  // (dia 28, 10:00), um por profissional. Total do tenant: 30; do profissional A: 26.
  const A_DAYS = Array.from({ length: 25 }, (_, i) => i + 1);
  let tied: Listed[];

  beforeAll(async () => {
    ctx = await createTestApp();
    p = await signupTenant(ctx.http, 'pg');
    o = await signupTenant(ctx.http, 'pgo');
    profA = await createUser(ctx.http, p, 'pg-a');
    profs = [profA, ...(await Promise.all([1, 2, 3, 4].map((n) => createUser(ctx.http, p, `pg-p${n}`))))];
    patient = await createPatient(ctx.http, p);

    // Fora de ordem, para provar que a ordenação é do banco e não da inserção.
    for (const day of [...A_DAYS].reverse()) {
      await book(p, patient.id, profA.id, at(day, 9));
    }
    tied = [];
    for (const prof of profs) {
      tied.push(await book(p, patient.id, prof.id, at(28, 10)));
    }

    const otherPatient = await createPatient(ctx.http, o);
    const otherProf = await createUser(ctx.http, o, 'pgo-a');
    await book(o, otherPatient.id, otherProf.id, at(1, 9));
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [p?.tenantId, o?.tenantId]);
    await ctx.app.close();
  });

  it('usa página de 50 por padrão e informa o total', async () => {
    const res = await list(p).expect(200);

    expect(res.body.data).toHaveLength(30);
    expect(res.body.meta).toEqual({ total: 30, page: 1, pageSize: 50, totalPages: 1 });
  });

  it('a ordem é por horário, do mais cedo ao mais tarde', async () => {
    const res = await list(p).expect(200);
    const times = (res.body.data as Listed[]).map((x) => Date.parse(x.scheduledAt));

    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it('páginas sucessivas cobrem tudo, sem repetir nem pular', async () => {
    const seen: Listed[] = [];
    for (const page of [1, 2, 3]) {
      const res = await list(p, { page, pageSize: 12 }).expect(200);
      expect(res.body.meta).toEqual({ total: 30, page, pageSize: 12, totalPages: 3 });
      seen.push(...res.body.data);
    }

    const everything = await list(p).expect(200);
    expect(seen).toHaveLength(30);
    expect(new Set(seen.map((x) => x.id)).size).toBe(30);
    expect(seen.map((x) => x.id)).toEqual(ids(everything.body));
  });

  it('agendamentos no mesmo horário têm ordem estável entre as páginas (desempate por id)', async () => {
    // Janela exata do dia 28 às 10:00: os 5 empatados, um por página.
    const window = { from: at(28, 10), to: at(28, 10), pageSize: 1 };
    const walked: string[] = [];
    for (const page of [1, 2, 3, 4, 5]) {
      const res = await list(p, { ...window, page }).expect(200);
      expect(res.body.meta.total).toBe(5);
      walked.push(res.body.data[0].id);
    }

    expect(new Set(walked).size).toBe(5);
    expect(new Set(walked)).toEqual(new Set(tied.map((x) => x.id)));
    // Empate no horário -> id crescente; a ordem de inserção (aleatória em relação ao id) não vale.
    expect(walked).toEqual([...walked].sort());
  });

  it('página além da última devolve lista vazia mas com o total certo', async () => {
    const res = await list(p, { page: 9, pageSize: 12 }).expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toEqual({ total: 30, page: 9, pageSize: 12, totalPages: 3 });
  });

  it('o total e as páginas refletem os filtros, não a tabela inteira', async () => {
    const byProfessional = await list(p, { professionalId: profA.id, pageSize: 10, page: 3 }).expect(200);
    expect(byProfessional.body.meta).toEqual({ total: 26, page: 3, pageSize: 10, totalPages: 3 });
    expect(byProfessional.body.data).toHaveLength(6);

    // Dias 10 a 14 às 09:00 (limites inclusivos) do profissional A: 5 agendamentos, 3 páginas de 2.
    const range = { professionalId: profA.id, from: at(10, 9), to: at(14, 9), pageSize: 2 };
    const pages = [];
    for (const page of [1, 2, 3]) {
      pages.push((await list(p, { ...range, page }).expect(200)).body);
    }
    expect(pages.map((x) => x.data.length)).toEqual([2, 2, 1]);
    expect(pages[0].meta).toEqual({ total: 5, page: 1, pageSize: 2, totalPages: 3 });
    expect(pages.flatMap((x) => x.data.map((a: Listed) => a.scheduledAt))).toEqual(
      [10, 11, 12, 13, 14].map((day) => at(day, 9)),
    );
  });

  it('aceita pageSize até 200', async () => {
    const res = await list(p, { pageSize: 200 }).expect(200);

    expect(res.body.data).toHaveLength(30);
    expect(res.body.meta.pageSize).toBe(200);
  });

  it('agendamentos cancelados continuam na listagem (com o status)', async () => {
    const extra = await book(p, patient.id, profA.id, at(30, 9));
    await ctx.http().delete(`${listUrl(p)}/${extra.id}`).set(p.auth).expect(200);

    const res = await list(p, { from: at(30, 9), to: at(30, 9) }).expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: extra.id, status: 'cancelled' });
    // Volta ao total original para não interferir nos outros testes.
    await ctx.prisma.appointment.delete({ where: { id: extra.id } });
  });

  it('cada tenant só vê e conta os próprios agendamentos', async () => {
    const res = await list(o).expect(200);

    expect(res.body.meta.total).toBe(1);
    expect((res.body.data as Listed[]).every((x) => x.tenantId === o.tenantId)).toBe(true);
    await list(p).set(o.auth).expect(403);
  });

  it.each([
    ['page=0', { page: 0 }],
    ['page negativa', { page: -1 }],
    ['page não numérica', { page: 'abc' }],
    ['page decimal', { page: 1.5 }],
    ['page absurda', { page: 1_000_000 }],
    ['pageSize=0', { pageSize: 0 }],
    ['pageSize acima de 200', { pageSize: 201 }],
    ['pageSize decimal', { pageSize: 2.5 }],
    ['parâmetro desconhecido', { orderBy: 'status' }],
    ['professionalId inválido', { professionalId: 'nao-uuid' }],
    ['from inválido', { from: 'ontem' }],
  ])('recusa parâmetros inválidos: %s (400)', async (_name, query) => {
    await list(p, query).expect(400);
  });
});
