import {
  cleanupTenants,
  createPatient,
  createTestApp,
  createUser,
  permissionIds,
  signupTenant,
  type TestApp,
  type TestTenant,
  type TestUser,
} from './helpers/e2e.js';

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
// Datas em 2031 (UTC) e um profissional novo por bloco: os blocos não disputam agenda entre si.
describe('Agenda de consultas (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;
  let c: TestTenant;
  let patientA: { id: string };
  let patientB: { id: string };

  const at = (day: number, hour: number, minute = 0) =>
    new Date(Date.UTC(2031, 0, day, hour, minute)).toISOString();
  const minutesOf = (appt: { scheduledAt: string; endsAt: string }) =>
    (new Date(appt.endsAt).getTime() - new Date(appt.scheduledAt).getTime()) / 60_000;

  const url = (t: TestTenant, suffix = '') => `/tenants/${t.tenantId}/appointments${suffix}`;

  // Cria um agendamento e devolve o request (para o teste escolher o status esperado).
  const book = (
    t: TestTenant,
    body: Record<string, unknown>,
    as: { auth: { Authorization: string } } = t,
  ) => ctx.http().post(url(t)).set(as.auth).send(body);

  const patch = (t: TestTenant, id: string, body: Record<string, unknown>) =>
    ctx.http().patch(url(t, `/${id}`)).set(t.auth).send(body);

  const bookOk = async (t: TestTenant, body: Record<string, unknown>) =>
    (await book(t, body).expect(201)).body as {
      id: string;
      scheduledAt: string;
      endsAt: string;
      status: string;
      professionalId: string;
    };

  const professional = (label: string, extra = {}) => createUser(ctx.http, a, label, extra);

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'ag-a');
    b = await signupTenant(ctx.http, 'ag-b');
    c = await signupTenant(ctx.http, 'ag-c');
    patientA = await createPatient(ctx.http, a);
    patientB = await createPatient(ctx.http, b);
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId, c?.tenantId]);
    await ctx.app.close();
  });

  describe('duração do atendimento', () => {
    it('sem endsAt usa a duração padrão da clínica (30 min)', async () => {
      const prof = await professional('prof-default');
      const appt = await bookOk(a, {
        patientId: patientA.id,
        professionalId: prof.id,
        scheduledAt: at(5, 9),
      });
      expect(appt.endsAt).toBe(at(5, 9, 30));
    });

    it('usa a duração do profissional quando ele tem uma própria', async () => {
      const prof = await professional('prof-45', { defaultAppointmentDurationMinutes: 45 });
      const appt = await bookOk(a, {
        patientId: patientA.id,
        professionalId: prof.id,
        scheduledAt: at(5, 9),
      });
      expect(minutesOf(appt)).toBe(45);
    });

    it('endsAt explícito prevalece sobre qualquer duração padrão', async () => {
      const prof = await professional('prof-explicit', { defaultAppointmentDurationMinutes: 45 });
      const appt = await bookOk(a, {
        patientId: patientA.id,
        professionalId: prof.id,
        scheduledAt: at(5, 9),
        endsAt: at(5, 11),
      });
      expect(minutesOf(appt)).toBe(120);
    });

    it('o profissional ajusta a própria duração sem precisar de users:manage', async () => {
      const [read, write] = await permissionIds(ctx.prisma, ['appointments:read', 'appointments:write']);
      const role = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(a.auth)
        .send({ name: `Profissional ${Date.now()}`, permissionIds: [read, write] })
        .expect(201);
      const prof = await professional('prof-self', { roleId: role.body.id });

      // Sem users:manage: não lista usuários...
      await ctx.http().get(`/tenants/${a.tenantId}/users`).set(prof.auth).expect(403);

      // ...mas ajusta a própria duração.
      const settingsUrl = `/tenants/${a.tenantId}/users/me/appointment-settings`;
      const updated = await ctx
        .http()
        .patch(settingsUrl)
        .set(prof.auth)
        .send({ defaultAppointmentDurationMinutes: 50 })
        .expect(200);
      expect(updated.body.defaultAppointmentDurationMinutes).toBe(50);
      expect(updated.body.passwordHash).toBeUndefined();

      const appt = await bookOk(a, {
        patientId: patientA.id,
        professionalId: prof.id,
        scheduledAt: at(5, 14),
      });
      expect(minutesOf(appt)).toBe(50);

      // null volta a valer a duração da clínica.
      const reverted = await ctx
        .http()
        .patch(settingsUrl)
        .set(prof.auth)
        .send({ defaultAppointmentDurationMinutes: null })
        .expect(200);
      expect(reverted.body.defaultAppointmentDurationMinutes).toBeNull();
      const next = await bookOk(a, {
        patientId: patientA.id,
        professionalId: prof.id,
        scheduledAt: at(5, 16),
      });
      expect(minutesOf(next)).toBe(30);

      // Valor inválido é recusado.
      await ctx
        .http()
        .patch(settingsUrl)
        .set(prof.auth)
        .send({ defaultAppointmentDurationMinutes: 2 })
        .expect(400);
    });

    it('a clínica define duração padrão e mínima, aplicadas a todos os agendamentos', async () => {
      await ctx
        .http()
        .patch(`/tenants/${c.tenantId}`)
        .set(c.auth)
        .send({ defaultAppointmentDurationMinutes: 60, minAppointmentDurationMinutes: 45 })
        .expect(200);
      const prof = await createUser(ctx.http, c, 'prof-c');
      const patient = await createPatient(ctx.http, c);
      const base = { patientId: patient.id, professionalId: prof.id };

      const byDefault = await bookOk(c, { ...base, scheduledAt: at(5, 9) });
      expect(minutesOf(byDefault)).toBe(60);

      const tooShort = await book(c, { ...base, scheduledAt: at(5, 11), endsAt: at(5, 11, 30) }).expect(400);
      expect(tooShort.body.message).toMatch(/45 minutos/);
      await book(c, { ...base, scheduledAt: at(5, 11), endsAt: at(5, 11, 45) }).expect(201);

      // Padrão não pode ser menor que o mínimo; mínimo não pode passar da duração de um profissional.
      await ctx
        .http()
        .patch(`/tenants/${c.tenantId}`)
        .set(c.auth)
        .send({ minAppointmentDurationMinutes: 70 })
        .expect(400);
      await createUser(ctx.http, c, 'prof-c-50', { defaultAppointmentDurationMinutes: 50 });
      await ctx
        .http()
        .patch(`/tenants/${c.tenantId}`)
        .set(c.auth)
        .send({ minAppointmentDurationMinutes: 55 })
        .expect(400);

      // Duração própria do profissional abaixo do mínimo da clínica é recusada.
      await ctx
        .http()
        .patch(`/tenants/${c.tenantId}/users/${prof.id}`)
        .set(c.auth)
        .send({ defaultAppointmentDurationMinutes: 30 })
        .expect(400);
    });
  });

  describe('validação do intervalo', () => {
    it('recusa fim igual ou anterior ao início e duração abaixo do mínimo da clínica (5 min)', async () => {
      const prof = await professional('prof-interval');
      const base = { patientId: patientA.id, professionalId: prof.id };

      await book(a, { ...base, scheduledAt: at(6, 9), endsAt: at(6, 9) }).expect(400);
      await book(a, { ...base, scheduledAt: at(6, 9), endsAt: at(6, 8) }).expect(400);
      await book(a, { ...base, scheduledAt: at(6, 9), endsAt: at(6, 9, 2) }).expect(400);
    });

    it('valida o formato do body', async () => {
      const prof = await professional('prof-body');
      const base = { patientId: patientA.id, professionalId: prof.id };

      await book(a, { ...base, scheduledAt: 'amanha de manha' }).expect(400);
      await book(a, { patientId: patientA.id, scheduledAt: at(6, 9) }).expect(400);
      await book(a, { ...base, scheduledAt: at(6, 9), campoExtra: true }).expect(400);
      await book(a, { patientId: 'nao-uuid', professionalId: prof.id, scheduledAt: at(6, 9) }).expect(400);
    });
  });

  describe('conflitos de horário', () => {
    let prof: TestUser;
    let other: TestUser;
    const base = () => ({ patientId: patientA.id, professionalId: prof.id });

    beforeAll(async () => {
      prof = await professional('prof-conflict');
      other = await professional('prof-other');
      // Referência: 10:00–11:00 no dia 7.
      await bookOk(a, { ...base(), scheduledAt: at(7, 10), endsAt: at(7, 11) });
    });

    it.each([
      ['começa dentro do existente', at(7, 10, 30), at(7, 11, 30)],
      ['termina dentro do existente', at(7, 9, 30), at(7, 10, 30)],
      ['está contido no existente', at(7, 10, 15), at(7, 10, 45)],
      ['contém o existente', at(7, 9), at(7, 12)],
      ['é idêntico ao existente', at(7, 10), at(7, 11)],
    ])('409 quando o novo horário %s', async (_name, start, end) => {
      await book(a, { ...base(), scheduledAt: start, endsAt: end }).expect(409);
    });

    it('permite encostar: termina quando o outro começa e começa quando o outro termina', async () => {
      await book(a, { ...base(), scheduledAt: at(7, 9), endsAt: at(7, 10) }).expect(201);
      await book(a, { ...base(), scheduledAt: at(7, 11), endsAt: at(7, 12) }).expect(201);
    });

    it('outro profissional pode ocupar o mesmo horário', async () => {
      await book(a, { ...base(), professionalId: other.id, scheduledAt: at(7, 10), endsAt: at(7, 11) }).expect(201);
    });

    it('cancelar libera o horário', async () => {
      const first = await bookOk(a, { ...base(), scheduledAt: at(7, 14), endsAt: at(7, 15) });
      await book(a, { ...base(), scheduledAt: at(7, 14), endsAt: at(7, 15) }).expect(409);

      await ctx.http().delete(url(a, `/${first.id}`)).set(a.auth).expect(200);

      await book(a, { ...base(), scheduledAt: at(7, 14), endsAt: at(7, 15) }).expect(201);
    });

    it('não comparecimento (no_show) libera o horário', async () => {
      const first = await bookOk(a, { ...base(), scheduledAt: at(7, 18), endsAt: at(7, 19) });
      await patch(a, first.id, { status: 'no_show' }).expect(200);

      await book(a, { ...base(), scheduledAt: at(7, 18), endsAt: at(7, 19) }).expect(201);
    });

    it('consulta concluída continua ocupando o horário', async () => {
      const first = await bookOk(a, { ...base(), scheduledAt: at(7, 16), endsAt: at(7, 17) });
      await patch(a, first.id, { status: 'completed' }).expect(200);

      await book(a, { ...base(), scheduledAt: at(7, 16, 30), endsAt: at(7, 17, 30) }).expect(409);
    });
  });

  describe('remarcação', () => {
    let prof: TestUser;
    const base = () => ({ patientId: patientA.id, professionalId: prof.id });

    beforeAll(async () => {
      prof = await professional('prof-resched');
    });

    it('remarcar só o início mantém a duração original', async () => {
      const appt = await bookOk(a, { ...base(), scheduledAt: at(8, 9), endsAt: at(8, 9, 50) });

      const res = await patch(a, appt.id, { scheduledAt: at(8, 13) }).expect(200);

      expect(res.body.scheduledAt).toBe(at(8, 13));
      expect(res.body.endsAt).toBe(at(8, 13, 50));
    });

    it('recusa remarcar para cima de outro agendamento e não altera nada', async () => {
      await bookOk(a, { ...base(), scheduledAt: at(8, 15), endsAt: at(8, 16) });
      const mine = await bookOk(a, { ...base(), scheduledAt: at(8, 17), endsAt: at(8, 18) });

      await patch(a, mine.id, { scheduledAt: at(8, 15, 30) }).expect(409);

      const after = await ctx.http().get(url(a, `/${mine.id}`)).set(a.auth).expect(200);
      expect(after.body.scheduledAt).toBe(at(8, 17));
    });

    it('pode deslocar o próprio horário sobrepondo o antigo (não conflita consigo mesmo)', async () => {
      const appt = await bookOk(a, { ...base(), scheduledAt: at(8, 19), endsAt: at(8, 20) });

      const res = await patch(a, appt.id, { scheduledAt: at(8, 19, 10) }).expect(200);

      expect(res.body.endsAt).toBe(at(8, 20, 10));
    });

    it('trocar de profissional respeita a agenda do novo', async () => {
      const busy = await professional('prof-busy');
      const free = await professional('prof-free');
      await bookOk(a, { ...base(), professionalId: busy.id, scheduledAt: at(9, 9), endsAt: at(9, 10) });
      const appt = await bookOk(a, { ...base(), scheduledAt: at(9, 9), endsAt: at(9, 10) });

      await patch(a, appt.id, { professionalId: busy.id }).expect(409);
      const moved = await patch(a, appt.id, { professionalId: free.id }).expect(200);
      expect(moved.body.professionalId).toBe(free.id);
    });

    it('não remarca agendamento cancelado', async () => {
      const appt = await bookOk(a, { ...base(), scheduledAt: at(10, 9), endsAt: at(10, 10) });
      await ctx.http().delete(url(a, `/${appt.id}`)).set(a.auth).expect(200);

      await patch(a, appt.id, { scheduledAt: at(10, 11) }).expect(409);
    });

    it('recusa fim anterior ao início na remarcação', async () => {
      const appt = await bookOk(a, { ...base(), scheduledAt: at(11, 9), endsAt: at(11, 10) });

      await patch(a, appt.id, { endsAt: at(11, 8) }).expect(400);
    });
  });

  describe('status', () => {
    let prof: TestUser;
    let slot = 8;
    // Um horário novo por agendamento, para o teste só exercitar a máquina de estados.
    const create = () =>
      bookOk(a, {
        patientId: patientA.id,
        professionalId: prof.id,
        scheduledAt: at(12, slot++),
        endsAt: at(12, slot),
      });

    beforeAll(async () => {
      prof = await professional('prof-status');
    });

    it('scheduled -> confirmed -> completed, sem voltar atrás', async () => {
      const appt = await create();
      expect(appt.status).toBe('scheduled');

      await patch(a, appt.id, { status: 'confirmed' }).expect(200);
      await patch(a, appt.id, { status: 'scheduled' }).expect(409);
      const done = await patch(a, appt.id, { status: 'completed' }).expect(200);
      expect(done.body.status).toBe('completed');
    });

    it('scheduled pode ir direto para completed, cancelled ou no_show', async () => {
      for (const status of ['completed', 'cancelled', 'no_show']) {
        const appt = await create();
        const res = await patch(a, appt.id, { status }).expect(200);
        expect(res.body.status).toBe(status);
      }
    });

    it('status finais congelam tudo, menos as observações', async () => {
      const appt = await create();
      await patch(a, appt.id, { status: 'completed' }).expect(200);

      await patch(a, appt.id, { status: 'cancelled' }).expect(409);
      await patch(a, appt.id, { status: 'confirmed' }).expect(409);
      await patch(a, appt.id, { scheduledAt: at(13, 9) }).expect(409);
      await patch(a, appt.id, { patientId: patientA.id, professionalId: prof.id }).expect(200);

      const noted = await patch(a, appt.id, { notes: 'Paciente retornou em 30 dias' }).expect(200);
      expect(noted.body).toMatchObject({ status: 'completed', notes: 'Paciente retornou em 30 dias' });
    });

    it('recusa status inexistente', async () => {
      const appt = await create();
      await patch(a, appt.id, { status: 'arquivado' }).expect(400);
    });

    it('DELETE cancela (não apaga) e é idempotente', async () => {
      const appt = await create();

      await ctx.http().delete(url(a, `/${appt.id}`)).set(a.auth).expect(200);
      await ctx.http().delete(url(a, `/${appt.id}`)).set(a.auth).expect(200);

      const found = await ctx.http().get(url(a, `/${appt.id}`)).set(a.auth).expect(200);
      expect(found.body.status).toBe('cancelled');
    });

    it('DELETE numa consulta já concluída é recusado', async () => {
      const appt = await create();
      await patch(a, appt.id, { status: 'completed' }).expect(200);

      await ctx.http().delete(url(a, `/${appt.id}`)).set(a.auth).expect(409);

      const found = await ctx.http().get(url(a, `/${appt.id}`)).set(a.auth).expect(200);
      expect(found.body.status).toBe('completed');
    });
  });

  describe('isolamento entre tenants e permissões', () => {
    let prof: TestUser;

    beforeAll(async () => {
      prof = await professional('prof-iso');
    });

    it('recusa paciente ou profissional de outro tenant (400)', async () => {
      await book(a, { patientId: patientB.id, professionalId: prof.id, scheduledAt: at(14, 9) }).expect(400);
      await book(a, { patientId: patientA.id, professionalId: b.id, scheduledAt: at(14, 9) }).expect(400);
    });

    it('recusa paciente removido e profissional desativado (400)', async () => {
      const removed = await createPatient(ctx.http, a);
      await ctx.http().delete(`/tenants/${a.tenantId}/patients/${removed.id}`).set(a.auth).expect(200);
      await book(a, { patientId: removed.id, professionalId: prof.id, scheduledAt: at(14, 10) }).expect(400);

      const inactive = await professional('prof-inactive');
      await ctx
        .http()
        .patch(`/tenants/${a.tenantId}/users/${inactive.id}`)
        .set(a.auth)
        .send({ status: 'disabled' })
        .expect(200);
      await book(a, { patientId: patientA.id, professionalId: inactive.id, scheduledAt: at(14, 11) }).expect(400);
    });

    it('não troca paciente/profissional de um agendamento por um de outro tenant', async () => {
      const appt = await bookOk(a, { patientId: patientA.id, professionalId: prof.id, scheduledAt: at(14, 13) });

      await patch(a, appt.id, { patientId: patientB.id }).expect(400);
      await patch(a, appt.id, { professionalId: b.id }).expect(400);
    });

    it('a URL de outro tenant é 403 e o id de outro tenant na própria URL é 404', async () => {
      const appt = await bookOk(a, { patientId: patientA.id, professionalId: prof.id, scheduledAt: at(14, 15) });

      await ctx.http().get(url(a)).set(b.auth).expect(403);
      await book(a, { patientId: patientA.id, professionalId: prof.id, scheduledAt: at(14, 16) }, b).expect(403);

      await ctx.http().get(url(b, `/${appt.id}`)).set(b.auth).expect(404);
      await patch(b, appt.id, { status: 'cancelled' }).expect(404);
      await ctx.http().delete(url(b, `/${appt.id}`)).set(b.auth).expect(404);

      const untouched = await ctx.http().get(url(a, `/${appt.id}`)).set(a.auth).expect(200);
      expect(untouched.body.status).toBe('scheduled');
    });

    it('a listagem de um tenant nunca traz agendamentos de outro', async () => {
      const res = await ctx.http().get(url(b)).set(b.auth).expect(200);
      expect((res.body as { tenantId: string }[]).every((x) => x.tenantId === b.tenantId)).toBe(true);
    });

    it('quem só tem appointments:read lê a agenda mas não escreve', async () => {
      const [read] = await permissionIds(ctx.prisma, ['appointments:read']);
      const role = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(a.auth)
        .send({ name: `Leitura ${Date.now()}`, permissionIds: [read] })
        .expect(201);
      const reader = await professional('leitor', { roleId: role.body.id });

      await ctx.http().get(url(a)).set(reader.auth).expect(200);
      await book(a, { patientId: patientA.id, professionalId: prof.id, scheduledAt: at(14, 17) }, reader).expect(403);
    });
  });

  describe('listagem e filtros', () => {
    let prof: TestUser;
    let p1: { id: string };
    let p2: { id: string };
    const listUrl = (query: string) => `${url(a)}?${query}`;
    const ids = (body: { id: string }[]) => body.map((x) => x.id);

    let d10_08: string, d10_10: string, d10_12: string, d11_09: string;

    beforeAll(async () => {
      prof = await professional('prof-list');
      p1 = await createPatient(ctx.http, a);
      p2 = await createPatient(ctx.http, a);
      const mk = async (patient: { id: string }, day: number, hour: number) =>
        (await bookOk(a, { patientId: patient.id, professionalId: prof.id, scheduledAt: at(day, hour) })).id;
      // Criados fora de ordem para provar que a listagem ordena por horário.
      d10_12 = await mk(p1, 10, 12);
      d11_09 = await mk(p1, 11, 9);
      d10_08 = await mk(p1, 10, 8);
      d10_10 = await mk(p2, 10, 10);
    });

    it('filtra por profissional e ordena por horário', async () => {
      const res = await ctx.http().get(listUrl(`professionalId=${prof.id}`)).set(a.auth).expect(200);
      expect(ids(res.body)).toEqual([d10_08, d10_10, d10_12, d11_09]);
    });

    it('filtra por paciente', async () => {
      const res = await ctx.http().get(listUrl(`patientId=${p2.id}`)).set(a.auth).expect(200);
      expect(ids(res.body)).toEqual([d10_10]);
    });

    it('filtra por período com limites inclusivos', async () => {
      const res = await ctx
        .http()
        .get(listUrl(`professionalId=${prof.id}&from=${at(10, 10)}&to=${at(10, 12)}`))
        .set(a.auth)
        .expect(200);
      expect(ids(res.body)).toEqual([d10_10, d10_12]);
    });

    it('combina filtros', async () => {
      const res = await ctx
        .http()
        .get(listUrl(`professionalId=${prof.id}&patientId=${p1.id}&from=${at(10, 9)}`))
        .set(a.auth)
        .expect(200);
      expect(ids(res.body)).toEqual([d10_12, d11_09]);
    });

    it('valida os filtros', async () => {
      await ctx.http().get(listUrl('professionalId=nao-uuid')).set(a.auth).expect(400);
      await ctx.http().get(listUrl('from=ontem')).set(a.auth).expect(400);
    });
  });

  // O advisory lock por profissional só se prova com requisições realmente simultâneas
  // contra um Postgres de verdade: sem ele, várias passariam juntas pela checagem de conflito.
  describe('concorrência', () => {
    const activeFor = (professionalId: string) =>
      ctx.prisma.appointment.findMany({
        where: { professionalId, status: { in: ['scheduled', 'confirmed', 'completed'] } },
        orderBy: { scheduledAt: 'asc' },
      });

    it('6 reservas simultâneas do mesmo horário: só uma vence, as outras dão 409', async () => {
      const prof = await professional('prof-race');
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          book(a, { patientId: patientA.id, professionalId: prof.id, scheduledAt: at(15, 9), endsAt: at(15, 10) }),
        ),
      );

      const statuses = results.map((r) => r.status).sort((x, y) => x - y);
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
      expect(await activeFor(prof.id)).toHaveLength(1);
    });

    it('8 reservas simultâneas parcialmente sobrepostas: a agenda final nunca tem sobreposição', async () => {
      const prof = await professional('prof-stagger');
      // 09:00, 09:10, ..., 10:10, cada uma com 30 min: vizinhas sempre se sobrepõem.
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          book(a, {
            patientId: patientA.id,
            professionalId: prof.id,
            scheduledAt: at(16, 9, i * 10),
            endsAt: at(16, 9, i * 10 + 30),
          }),
        ),
      );

      const accepted = results.filter((r) => r.status === 201);
      expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      expect(accepted.length).toBeGreaterThanOrEqual(1);

      const stored = await activeFor(prof.id);
      expect(stored).toHaveLength(accepted.length);
      for (let i = 1; i < stored.length; i++) {
        expect(stored[i].scheduledAt.getTime()).toBeGreaterThanOrEqual(stored[i - 1].endsAt.getTime());
      }
    });

    it('profissionais diferentes no mesmo horário não se bloqueiam', async () => {
      const profs = await Promise.all([1, 2, 3, 4].map((n) => professional(`prof-par-${n}`)));
      const results = await Promise.all(
        profs.map((p) =>
          book(a, { patientId: patientA.id, professionalId: p.id, scheduledAt: at(17, 9), endsAt: at(17, 10) }),
        ),
      );

      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    });

    it('duas remarcações simultâneas para o mesmo horário: só uma vence', async () => {
      const prof = await professional('prof-race-move');
      const x = await bookOk(a, { patientId: patientA.id, professionalId: prof.id, scheduledAt: at(18, 9), endsAt: at(18, 10) });
      const y = await bookOk(a, { patientId: patientA.id, professionalId: prof.id, scheduledAt: at(18, 11), endsAt: at(18, 12) });

      const results = await Promise.all(
        [x, y].map((appt) => patch(a, appt.id, { scheduledAt: at(18, 14), endsAt: at(18, 15) })),
      );

      expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([200, 409]);
      const atFourteen = (await activeFor(prof.id)).filter((appt) => appt.scheduledAt.toISOString() === at(18, 14));
      expect(atFourteen).toHaveLength(1);
    });
  });
});
