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
  status: string;
  scheduledAt: string;
}

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Agenda: filtros de janela e status (e2e)', () => {
  let ctx: TestApp;
  let t: TestTenant;
  let other: TestTenant;
  let patient: { id: string };

  const at = (day: number, hour: number, minute = 0) =>
    new Date(Date.UTC(2033, 0, day, hour, minute)).toISOString();
  const url = (tenant: TestTenant) => `/tenants/${tenant.tenantId}/appointments`;
  const list = (query: Record<string, string | number | string[]> = {}) =>
    ctx.http().get(url(t)).query(query).set(t.auth);
  const ids = (body: { data: Listed[] }) => body.data.map((x) => x.id);

  const book = async (professional: TestUser, start: string, end: string) =>
    (
      await ctx
        .http()
        .post(url(t))
        .set(t.auth)
        .send({ patientId: patient.id, professionalId: professional.id, scheduledAt: start, endsAt: end })
        .expect(201)
    ).body as Listed;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await signupTenant(ctx.http, 'fl');
    other = await signupTenant(ctx.http, 'flo');
    patient = await createPatient(ctx.http, t);
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [t?.tenantId, other?.tenantId]);
    await ctx.app.close();
  });

  // Um profissional com agendamentos encostados ao longo do dia 12, mais um longo à tarde.
  describe('janela from/to por sobreposição', () => {
    let prof: TestUser;
    const slot: Record<string, string> = {};
    const win = (query: Record<string, string | number>) => list({ professionalId: prof.id, ...query });
    const named = async (query: Record<string, string | number>) => {
      const res = await win(query).expect(200);
      const byId = Object.fromEntries(Object.entries(slot).map(([name, id]) => [id, name]));
      return ids(res.body).map((id) => byId[id]);
    };

    beforeAll(async () => {
      prof = await createUser(ctx.http, t, 'fl-x');
      slot.s1 = (await book(prof, at(12, 8), at(12, 9))).id; // 08–09
      slot.s2 = (await book(prof, at(12, 9), at(12, 10))).id; // 09–10
      slot.s3 = (await book(prof, at(12, 10), at(12, 11))).id; // 10–11
      slot.s4 = (await book(prof, at(12, 11), at(12, 12))).id; // 11–12
      slot.s5 = (await book(prof, at(12, 12), at(12, 13))).id; // 12–13
      slot.s6 = (await book(prof, at(12, 13), at(12, 14))).id; // 13–14
      slot.L = (await book(prof, at(12, 14), at(12, 18))).id; // 14–18 (longo)
    });

    it('um atendimento em andamento na janela entra, mesmo tendo começado antes de from', async () => {
      // s2 (09–10) começou antes de 09:30 e ainda está em curso: antes do ajuste ele sumia.
      expect(await named({ from: at(12, 9, 30), to: at(12, 12) })).toEqual(['s2', 's3', 's4', 's5']);
    });

    it('um instante dentro de um atendimento o encontra', async () => {
      expect(await named({ from: at(12, 9, 30), to: at(12, 9, 30) })).toEqual(['s2']);
    });

    it('um atendimento mais longo que a janela, que a envolve por inteiro, entra', async () => {
      expect(await named({ from: at(12, 15), to: at(12, 16) })).toEqual(['L']);
    });

    it('quem termina exatamente em from só encosta na janela e fica de fora', async () => {
      // s2 (09–10) termina às 10:00; a janela começa às 10:00.
      expect(await named({ from: at(12, 10), to: at(12, 10) })).toEqual(['s3']);
      // s1 (08–09) termina às 09:00; s2 começa às 09:00.
      expect(await named({ from: at(12, 9), to: at(12, 9) })).toEqual(['s2']);
    });

    it('quem começa exatamente em to entra (limite superior inclusivo)', async () => {
      expect(await named({ from: at(12, 11, 30), to: at(12, 12) })).toEqual(['s4', 's5']);
    });

    it('só from (sem limite superior) e só to (sem limite inferior)', async () => {
      // 13:30 em diante: s6 (13–14) está em curso, depois L.
      expect(await named({ from: at(12, 13, 30) })).toEqual(['s6', 'L']);
      // Até 09:00 inclusive: s1 e s2 (que começa às 09:00).
      expect(await named({ to: at(12, 9) })).toEqual(['s1', 's2']);
    });

    it('janela sem nada devolve vazio; o dia todo devolve tudo em ordem', async () => {
      expect((await win({ from: at(12, 6), to: at(12, 7) }).expect(200)).body.meta.total).toBe(0);
      expect(await named({ from: at(12, 0), to: at(12, 23, 59) })).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 'L']);
    });

    it('o total e a paginação seguem a janela', async () => {
      const page1 = await win({ from: at(12, 9, 30), to: at(12, 12), pageSize: 3 }).expect(200);
      const page2 = await win({ from: at(12, 9, 30), to: at(12, 12), pageSize: 3, page: 2 }).expect(200);

      expect(page1.body.meta).toEqual({ total: 4, page: 1, pageSize: 3, totalPages: 2 });
      expect(ids(page1.body)).toEqual([slot.s2, slot.s3, slot.s4]);
      expect(ids(page2.body)).toEqual([slot.s5]);
    });

    it('from depois de to é erro do cliente (400), não uma lista vazia silenciosa', async () => {
      const res = await win({ from: at(12, 12), to: at(12, 9) }).expect(400);
      expect(res.body.message).toMatch(/from/);
    });

    it('o mesmo agendamento de outro tenant nunca aparece', async () => {
      const otherPatient = await createPatient(ctx.http, other);
      const otherProf = await createUser(ctx.http, other, 'flo-x');
      await ctx
        .http()
        .post(url(other))
        .set(other.auth)
        .send({ patientId: otherPatient.id, professionalId: otherProf.id, scheduledAt: at(12, 9), endsAt: at(12, 10) })
        .expect(201);

      const res = await list({ from: at(12, 9), to: at(12, 10) }).expect(200);

      expect(ids(res.body).every((id) => Object.values(slot).includes(id))).toBe(true);
    });
  });

  describe('filtro por status', () => {
    let prof: TestUser;
    const byStatus: Record<string, string> = {};
    const q = (query: Record<string, string | number | string[]>) => list({ professionalId: prof.id, ...query });
    const statuses = (body: { data: Listed[] }) => body.data.map((x) => x.status).sort();

    beforeAll(async () => {
      prof = await createUser(ctx.http, t, 'fl-y');
      // Cinco agendamentos, um em cada status (09h, 10h, 11h, 12h, 13h do dia 13).
      const make = async (hour: number) => book(prof, at(13, hour), at(13, hour, 30));
      byStatus.scheduled = (await make(9)).id;
      byStatus.confirmed = (await make(10)).id;
      byStatus.completed = (await make(11)).id;
      byStatus.cancelled = (await make(12)).id;
      byStatus.no_show = (await make(13)).id;

      const setStatus = (status: string) =>
        ctx.http().patch(`${url(t)}/${byStatus[status]}`).set(t.auth).send({ status }).expect(200);
      for (const status of ['confirmed', 'completed', 'cancelled', 'no_show']) {
        await setStatus(status);
      }
    });

    it('sem o parâmetro, devolve todos os status', async () => {
      const res = await q({}).expect(200);
      expect(statuses(res.body)).toEqual(['cancelled', 'completed', 'confirmed', 'no_show', 'scheduled']);
    });

    it('um status', async () => {
      const res = await q({ status: 'cancelled' }).expect(200);
      expect(ids(res.body)).toEqual([byStatus.cancelled]);
      expect(res.body.meta.total).toBe(1);
    });

    it('vários status separados por vírgula', async () => {
      const res = await q({ status: 'scheduled,confirmed' }).expect(200);
      expect(statuses(res.body)).toEqual(['confirmed', 'scheduled']);
    });

    it('vários status repetindo o parâmetro (?status=a&status=b e a[]=)', async () => {
      const repeated = await ctx
        .http()
        .get(`${url(t)}?professionalId=${prof.id}&status=cancelled&status=no_show`)
        .set(t.auth)
        .expect(200);
      const asArray = await q({ status: ['cancelled', 'no_show'] }).expect(200);

      expect(statuses(repeated.body)).toEqual(['cancelled', 'no_show']);
      expect(statuses(asArray.body)).toEqual(['cancelled', 'no_show']);
    });

    it('tolera espaços, duplicados e valor vazio (vazio = sem filtro)', async () => {
      expect(statuses((await q({ status: ' scheduled , scheduled ' }).expect(200)).body)).toEqual(['scheduled']);
      expect((await q({ status: '' }).expect(200)).body.meta.total).toBe(5);
      expect((await q({ status: ',' }).expect(200)).body.meta.total).toBe(5);
    });

    it('o "calendário sem cancelados": todos menos cancelados e faltas', async () => {
      const res = await q({ status: 'scheduled,confirmed,completed' }).expect(200);
      expect(statuses(res.body)).toEqual(['completed', 'confirmed', 'scheduled']);
    });

    it('o total e as páginas contam só o que passou pelo filtro', async () => {
      const first = await q({ status: 'scheduled,confirmed,completed', pageSize: 2 }).expect(200);
      const second = await q({ status: 'scheduled,confirmed,completed', pageSize: 2, page: 2 }).expect(200);

      expect(first.body.meta).toEqual({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
      expect(first.body.data).toHaveLength(2);
      expect(second.body.data).toHaveLength(1);
    });

    it('combina com a janela de datas e com paciente', async () => {
      const inWindow = await q({ status: 'confirmed,completed', from: at(13, 10, 15), to: at(13, 11, 15) }).expect(200);
      expect(statuses(inWindow.body)).toEqual(['completed', 'confirmed']);

      const noneInWindow = await q({ status: 'cancelled', from: at(13, 9), to: at(13, 10) }).expect(200);
      expect(noneInWindow.body.data).toEqual([]);

      const byPatient = await q({ status: 'no_show', patientId: patient.id }).expect(200);
      expect(ids(byPatient.body)).toEqual([byStatus.no_show]);
    });

    it.each([
      ['status inexistente', { status: 'arquivado' }],
      ['um válido e um inexistente', { status: 'scheduled,arquivado' }],
      ['maiúsculas (os valores são minúsculos)', { status: 'SCHEDULED' }],
      ['objeto no lugar de texto', { 'status[a]': 'scheduled' }],
    ])('recusa status inválido: %s (400)', async (_name, query) => {
      await q(query).expect(400);
    });
  });
});
