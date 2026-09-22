import { randomUUID } from 'node:crypto';
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
describe('Financeiro: cobranças e pagamentos (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;
  let patientA: { id: string };
  let patientB: { id: string };

  const chargesUrl = (t: TestTenant, suffix = '') => `/tenants/${t.tenantId}/charges${suffix}`;
  const summaryUrl = (t: TestTenant) => `/tenants/${t.tenantId}/billing/summary`;

  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const daysFromNow = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return isoDate(d);
  };

  const create = (t: TestTenant, body: Record<string, unknown>, as: TestUser = t) =>
    ctx.http().post(chargesUrl(t)).set(as.auth).send(body);
  const createOk = async (t: TestTenant, body: Record<string, unknown>) =>
    (await create(t, { patientId: patientA.id, description: 'Consulta', amountCents: 15_000, dueDate: daysFromNow(7), ...body }).expect(201)).body;
  const pay = (t: TestTenant, chargeId: string, body: Record<string, unknown>, as: TestUser = t) =>
    ctx.http().post(chargesUrl(t, `/${chargeId}/payments`)).set(as.auth).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'bill-a');
    b = await signupTenant(ctx.http, 'bill-b');
    patientA = await createPatient(ctx.http, a);
    patientB = await createPatient(ctx.http, b);
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId]);
    await ctx.app.close();
  });

  describe('criar cobrança', () => {
    it('cria com os campos básicos e nasce pendente, com isOverdue calculado', async () => {
      const res = await create(a, {
        patientId: patientA.id,
        description: 'Consulta de rotina',
        amountCents: 15_000,
        dueDate: daysFromNow(7),
      }).expect(201);

      expect(res.body).toMatchObject({
        patientId: patientA.id,
        description: 'Consulta de rotina',
        amountCents: 15_000,
        status: 'pending',
        isOverdue: false,
        createdByUserId: a.id,
      });
    });

    it('vencida no passado já nasce isOverdue: true', async () => {
      const res = await createOk(a, { dueDate: daysFromNow(-1) });
      expect(res.isOverdue).toBe(true);
    });

    it('pode citar um agendamento do mesmo paciente', async () => {
      const professional = await createUser(ctx.http, a, 'prof-bill');
      const appt = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/appointments`)
        .set(a.auth)
        .send({ patientId: patientA.id, professionalId: professional.id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() })
        .expect(201);

      const res = await createOk(a, { appointmentId: appt.body.id });
      expect(res.appointmentId).toBe(appt.body.id);
    });

    it('recusa agendamento de outro paciente (400)', async () => {
      const professional = await createUser(ctx.http, a, 'prof-bill2');
      const otherPatient = await createPatient(ctx.http, a);
      const appt = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/appointments`)
        .set(a.auth)
        .send({ patientId: otherPatient.id, professionalId: professional.id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() })
        .expect(201);

      await create(a, { patientId: patientA.id, description: 'x', amountCents: 100, dueDate: daysFromNow(1), appointmentId: appt.body.id }).expect(400);
    });

    it('recusa paciente ou agendamento de outro tenant (400)', async () => {
      await create(a, { patientId: patientB.id, description: 'x', amountCents: 100, dueDate: daysFromNow(1) }).expect(400);

      const foreignProf = await createUser(ctx.http, b, 'prof-b');
      const foreignAppt = await ctx
        .http()
        .post(`/tenants/${b.tenantId}/appointments`)
        .set(b.auth)
        .send({ patientId: patientB.id, professionalId: foreignProf.id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() })
        .expect(201);
      await create(a, { patientId: patientA.id, description: 'x', amountCents: 100, dueDate: daysFromNow(1), appointmentId: foreignAppt.body.id }).expect(400);
    });

    it('valida o body: valor não positivo, campos ausentes, data inválida, campo desconhecido', async () => {
      await create(a, { patientId: patientA.id, description: 'x', amountCents: 0, dueDate: daysFromNow(1) }).expect(400);
      await create(a, { patientId: patientA.id, description: 'x', amountCents: -100, dueDate: daysFromNow(1) }).expect(400);
      await create(a, { patientId: patientA.id, amountCents: 100, dueDate: daysFromNow(1) }).expect(400);
      await create(a, { patientId: patientA.id, description: 'x', amountCents: 100, dueDate: 'não-é-data' }).expect(400);
      await create(a, { patientId: patientA.id, description: 'x', amountCents: 100, dueDate: daysFromNow(1), extra: 1 }).expect(400);
    });
  });

  describe('listar e filtrar', () => {
    it('ordena por vencimento (mais cedo primeiro), com desempate por id', async () => {
      const tag = randomUUID();
      const c1 = await createOk(a, { description: tag, dueDate: daysFromNow(10) });
      const c2 = await createOk(a, { description: tag, dueDate: daysFromNow(5) });
      const c3 = await createOk(a, { description: tag, dueDate: daysFromNow(15) });

      const res = await ctx.http().get(chargesUrl(a)).query({ pageSize: 100 }).set(a.auth).expect(200);
      const ids = (res.body.data as { id: string; description: string }[])
        .filter((c) => c.description === tag)
        .map((c) => c.id);
      expect(ids).toEqual([c2.id, c1.id, c3.id]);
    });

    it('filtra por paciente', async () => {
      const other = await createPatient(ctx.http, a);
      const charge = await createOk(a, { patientId: other.id });

      const res = await ctx.http().get(chargesUrl(a)).query({ patientId: other.id }).set(a.auth).expect(200);
      expect((res.body.data as { id: string }[]).map((c) => c.id)).toEqual([charge.id]);
    });

    it('pending e overdue se excluem: uma cobrança pendente cai em exatamente um dos dois', async () => {
      const tag = randomUUID();
      const future = await createOk(a, { description: tag, dueDate: daysFromNow(30) });
      const late = await createOk(a, { description: tag, dueDate: daysFromNow(-2) });

      const pending = await ctx.http().get(chargesUrl(a)).query({ status: 'pending', pageSize: 100 }).set(a.auth).expect(200);
      const overdue = await ctx.http().get(chargesUrl(a)).query({ status: 'overdue', pageSize: 100 }).set(a.auth).expect(200);
      const pendingIds = (pending.body.data as { id: string; description: string }[]).filter((c) => c.description === tag).map((c) => c.id);
      const overdueIds = (overdue.body.data as { id: string; description: string }[]).filter((c) => c.description === tag).map((c) => c.id);

      expect(pendingIds).toEqual([future.id]);
      expect(overdueIds).toEqual([late.id]);
    });

    it('filtra por status paid e cancelled', async () => {
      const toPay = await createOk(a, {});
      await pay(a, toPay.id, { amountCents: toPay.amountCents, method: 'pix' }).expect(201);
      const toCancel = await createOk(a, {});
      await ctx.http().delete(chargesUrl(a, `/${toCancel.id}`)).set(a.auth).expect(200);

      const paid = await ctx.http().get(chargesUrl(a)).query({ status: 'paid', pageSize: 100 }).set(a.auth).expect(200);
      const cancelled = await ctx.http().get(chargesUrl(a)).query({ status: 'cancelled', pageSize: 100 }).set(a.auth).expect(200);
      expect((paid.body.data as { id: string }[]).some((c) => c.id === toPay.id)).toBe(true);
      expect((cancelled.body.data as { id: string }[]).some((c) => c.id === toCancel.id)).toBe(true);
    });

    it('filtra por janela de vencimento (from/to, limites inclusivos)', async () => {
      const tag = randomUUID();
      const inside = await createOk(a, { description: tag, dueDate: daysFromNow(20) });
      await createOk(a, { description: tag, dueDate: daysFromNow(19) });
      await createOk(a, { description: tag, dueDate: daysFromNow(21) });

      const res = await ctx
        .http()
        .get(chargesUrl(a))
        .query({ from: daysFromNow(20), to: daysFromNow(20), pageSize: 100 })
        .set(a.auth)
        .expect(200);
      const ids = (res.body.data as { id: string; description: string }[]).filter((c) => c.description === tag).map((c) => c.id);
      expect(ids).toEqual([inside.id]);
    });

    it('a listagem de um tenant nunca traz cobranças de outro', async () => {
      const charge = await createOk(a, {});
      const res = await ctx.http().get(chargesUrl(b)).query({ pageSize: 100 }).set(b.auth).expect(200);
      expect((res.body.data as { id: string }[]).some((c) => c.id === charge.id)).toBe(false);
    });

    it('parâmetros inválidos dão 400', async () => {
      await ctx.http().get(chargesUrl(a)).query({ page: 0 }).set(a.auth).expect(400);
      await ctx.http().get(chargesUrl(a)).query({ status: 'inexistente' }).set(a.auth).expect(400);
      await ctx.http().get(chargesUrl(a)).query({ patientId: 'nao-uuid' }).set(a.auth).expect(400);
    });

    it('404 para cobrança inexistente ou de outro tenant', async () => {
      const charge = await createOk(a, {});
      await ctx.http().get(chargesUrl(a, `/${randomUUID()}`)).set(a.auth).expect(404);
      await ctx.http().get(chargesUrl(b, `/${charge.id}`)).set(b.auth).expect(404);
    });
  });

  describe('editar e cancelar', () => {
    it('edita campos de conteúdo enquanto pendente', async () => {
      const charge = await createOk(a, {});
      const res = await ctx
        .http()
        .patch(chargesUrl(a, `/${charge.id}`))
        .set(a.auth)
        .send({ description: 'Atualizada', amountCents: 20_000 })
        .expect(200);
      expect(res.body).toMatchObject({ description: 'Atualizada', amountCents: 20_000 });
    });

    it('cancela (DELETE) uma cobrança pendente sem pagamento', async () => {
      const charge = await createOk(a, {});
      await ctx.http().delete(chargesUrl(a, `/${charge.id}`)).set(a.auth).expect(200);
      const res = await ctx.http().get(chargesUrl(a, `/${charge.id}`)).set(a.auth).expect(200);
      expect(res.body.status).toBe('cancelled');
    });

    it('uma vez paga, não pode ser editada, cancelada nem receber outro pagamento', async () => {
      const charge = await createOk(a, {});
      await pay(a, charge.id, { amountCents: charge.amountCents, method: 'cash' }).expect(201);

      await ctx.http().patch(chargesUrl(a, `/${charge.id}`)).set(a.auth).send({ description: 'x' }).expect(409);
      await ctx.http().delete(chargesUrl(a, `/${charge.id}`)).set(a.auth).expect(409);
      await pay(a, charge.id, { amountCents: 1, method: 'cash' }).expect(409);
    });

    it('uma vez cancelada, não pode ser editada nem reaberta', async () => {
      const charge = await createOk(a, {});
      await ctx.http().delete(chargesUrl(a, `/${charge.id}`)).set(a.auth).expect(200);

      await ctx.http().patch(chargesUrl(a, `/${charge.id}`)).set(a.auth).send({ description: 'x' }).expect(409);
      await ctx.http().patch(chargesUrl(a, `/${charge.id}`)).set(a.auth).send({ status: 'pending' }).expect(409);
    });

    it('cobrança com pagamento parcial (ainda pendente) também não pode ser editada nem cancelada', async () => {
      const charge = await createOk(a, { amountCents: 10_000 });
      await pay(a, charge.id, { amountCents: 3_000, method: 'pix' }).expect(201);

      const stillPending = await ctx.http().get(chargesUrl(a, `/${charge.id}`)).set(a.auth).expect(200);
      expect(stillPending.body.status).toBe('pending');

      await ctx.http().patch(chargesUrl(a, `/${charge.id}`)).set(a.auth).send({ amountCents: 5_000 }).expect(409);
      await ctx.http().delete(chargesUrl(a, `/${charge.id}`)).set(a.auth).expect(409);
    });

    it('não muda para um paciente ou agendamento de outro tenant', async () => {
      const charge = await createOk(a, {});
      await ctx.http().patch(chargesUrl(a, `/${charge.id}`)).set(a.auth).send({ patientId: patientB.id }).expect(400);
    });

    it('status inválido (fora do enum) dá 400', async () => {
      const charge = await createOk(a, {});
      await ctx.http().patch(chargesUrl(a, `/${charge.id}`)).set(a.auth).send({ status: 'arquivada' }).expect(400);
    });
  });

  describe('pagamentos', () => {
    it('pagamento parcial mantém a cobrança pendente; completar o valor marca como paga', async () => {
      const charge = await createOk(a, { amountCents: 10_000 });

      const partial = await pay(a, charge.id, { amountCents: 4_000, method: 'pix' }).expect(201);
      expect(partial.body).toMatchObject({ amountCents: 4_000, method: 'pix' });
      expect((await ctx.http().get(chargesUrl(a, `/${charge.id}`)).set(a.auth).expect(200)).body.status).toBe('pending');

      await pay(a, charge.id, { amountCents: 6_000, method: 'cash' }).expect(201);
      const final = await ctx.http().get(chargesUrl(a, `/${charge.id}`)).set(a.auth).expect(200);
      expect(final.body.status).toBe('paid');
      expect(final.body.payments).toHaveLength(2);
    });

    it('recusa pagamento que excede o saldo devedor, informando o valor exato restante', async () => {
      const charge = await createOk(a, { amountCents: 10_000 });
      await pay(a, charge.id, { amountCents: 7_000, method: 'pix' }).expect(201);

      const res = await pay(a, charge.id, { amountCents: 4_000, method: 'cash' }).expect(400);
      expect(res.body.message).toContain('3000');
    });

    it('lista os pagamentos do mais recente para o mais antigo', async () => {
      const charge = await createOk(a, { amountCents: 10_000 });
      const p1 = await pay(a, charge.id, { amountCents: 3_000, method: 'pix' }).expect(201);
      const p2 = await pay(a, charge.id, { amountCents: 3_000, method: 'cash' }).expect(201);

      const res = await ctx.http().get(chargesUrl(a, `/${charge.id}/payments`)).set(a.auth).expect(200);
      expect((res.body as { id: string }[]).map((p) => p.id)).toEqual([p2.body.id, p1.body.id]);
    });

    it('registra quem recebeu o pagamento e aceita paidAt/notes explícitos', async () => {
      const charge = await createOk(a, {});
      const res = await pay(a, charge.id, {
        amountCents: charge.amountCents,
        method: 'bank_transfer',
        paidAt: daysFromNow(-3),
        notes: 'Conciliado manualmente',
      }).expect(201);
      expect(res.body).toMatchObject({ recordedByUserId: a.id, notes: 'Conciliado manualmente' });
    });

    it('valida o body: valor não positivo, método desconhecido, campo desconhecido', async () => {
      const charge = await createOk(a, {});
      await pay(a, charge.id, { amountCents: 0, method: 'pix' }).expect(400);
      await pay(a, charge.id, { amountCents: -100, method: 'pix' }).expect(400);
      await pay(a, charge.id, { amountCents: 100, method: 'boleto' }).expect(400);
      await pay(a, charge.id, { amountCents: 100, method: 'pix', extra: 1 }).expect(400);
    });

    it('404 ao pagar cobrança inexistente ou de outro tenant', async () => {
      await pay(a, randomUUID(), { amountCents: 100, method: 'pix' }).expect(404);
      const charge = await createOk(a, {});
      await pay(b, charge.id, { amountCents: 100, method: 'pix' }, b).expect(404);
    });
  });

  // O advisory lock por cobrança só se prova com requisições realmente simultâneas contra um
  // Postgres de verdade: sem ele, várias poderiam passar juntas pela checagem de saldo e somar
  // mais do que a cobrança vale (mesmo problema, e mesma solução, da sobreposição de agenda).
  describe('concorrência', () => {
    it('6 pagamentos simultâneos de 1/5 do valor: só 5 vencem, nenhum excede o total', async () => {
      const charge = await createOk(a, { amountCents: 10_000 });
      const results = await Promise.all(
        Array.from({ length: 6 }, () => pay(a, charge.id, { amountCents: 2_000, method: 'pix' })),
      );

      // 5×2000 fecha o valor exato: o lock serializa, então quem chega por último sempre
      // encontra a cobrança já `paid` (409) — não é uma corrida indefinida entre 400 e 409,
      // é sempre 409 dado que 5 pagamentos bastam para fechar a conta exatamente.
      const statuses = results.map((r) => r.status).sort((x, y) => x - y);
      expect(statuses).toEqual([201, 201, 201, 201, 201, 409]);

      const payments = await ctx.prisma.payment.findMany({ where: { chargeId: charge.id } });
      expect(payments.reduce((sum, p) => sum + p.amountCents, 0)).toBe(10_000);
      expect((await ctx.prisma.charge.findUniqueOrThrow({ where: { id: charge.id } })).status).toBe('paid');
    });

    it('pagamentos simultâneos de tamanhos diferentes: a soma final nunca passa do valor', async () => {
      const charge = await createOk(a, { amountCents: 10_000 });
      const results = await Promise.all(
        [4_000, 4_000, 4_000, 4_000].map((amountCents) => pay(a, charge.id, { amountCents, method: 'cash' })),
      );

      expect(results.every((r) => r.status === 201 || r.status === 400)).toBe(true);
      const payments = await ctx.prisma.payment.findMany({ where: { chargeId: charge.id } });
      const total = payments.reduce((sum, p) => sum + p.amountCents, 0);
      expect(total).toBeLessThanOrEqual(10_000);
      expect(total).toBeGreaterThan(0);
    });

    it('cobranças diferentes não se bloqueiam entre si', async () => {
      const charges = await Promise.all([createOk(a, {}), createOk(a, {}), createOk(a, {})]);
      const results = await Promise.all(charges.map((c) => pay(a, c.id, { amountCents: c.amountCents, method: 'pix' })));
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    });
  });

  describe('resumo financeiro', () => {
    it('agrega pendente, atrasado, cancelado e pago no período', async () => {
      const t = await signupTenant(ctx.http, 'summary');
      const patient = await createPatient(ctx.http, t);
      const mk = (extra: Record<string, unknown>) =>
        ctx
          .http()
          .post(chargesUrl(t))
          .set(t.auth)
          .send({ patientId: patient.id, description: 'x', amountCents: 10_000, dueDate: daysFromNow(30), ...extra })
          .expect(201);

      await mk({});
      await mk({ dueDate: daysFromNow(-5) });
      const toCancel = (await mk({})).body;
      await ctx.http().delete(chargesUrl(t, `/${toCancel.id}`)).set(t.auth).expect(200);
      const toPay = (await mk({})).body;
      await pay(t, toPay.id, { amountCents: 10_000, method: 'pix' }).expect(201);

      const res = await ctx.http().get(summaryUrl(t)).set(t.auth).expect(200);
      expect(res.body).toEqual({
        pending: { count: 1, amountCents: 10_000 },
        overdue: { count: 1, amountCents: 10_000 },
        cancelled: { count: 1, amountCents: 10_000 },
        paidInPeriod: { count: 1, amountCents: 10_000 },
      });

      await cleanupTenants(ctx.prisma, [t.tenantId]);
    });

    it('paidInPeriod respeita from/to (por data do pagamento)', async () => {
      const t = await signupTenant(ctx.http, 'summary-period');
      const patient = await createPatient(ctx.http, t);
      const charge = (
        await ctx
          .http()
          .post(chargesUrl(t))
          .set(t.auth)
          .send({ patientId: patient.id, description: 'x', amountCents: 10_000, dueDate: daysFromNow(1) })
          .expect(201)
      ).body;
      await pay(t, charge.id, { amountCents: 10_000, method: 'pix', paidAt: daysFromNow(-10) }).expect(201);

      const outside = await ctx.http().get(summaryUrl(t)).query({ from: daysFromNow(-2), to: daysFromNow(2) }).set(t.auth).expect(200);
      const inside = await ctx.http().get(summaryUrl(t)).query({ from: daysFromNow(-15), to: daysFromNow(-5) }).set(t.auth).expect(200);

      expect(outside.body.paidInPeriod).toEqual({ count: 0, amountCents: 0 });
      expect(inside.body.paidInPeriod).toEqual({ count: 1, amountCents: 10_000 });

      await cleanupTenants(ctx.prisma, [t.tenantId]);
    });

    it('é isolado por tenant', async () => {
      await createOk(a, {});
      const res = await ctx.http().get(summaryUrl(b)).set(b.auth).expect(200);
      expect(res.body.pending.count).toBe(0);
    });
  });

  describe('permissões e isolamento', () => {
    let reader: TestUser;

    beforeAll(async () => {
      const [readOnly] = await permissionIds(ctx.prisma, ['billing:read']);
      const role = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(a.auth)
        .send({ name: `Leitura financeiro ${randomUUID()}`, permissionIds: [readOnly] })
        .expect(201);
      reader = await createUser(ctx.http, a, 'leitor-fin', { roleId: role.body.id });
    });

    it('billing:read só lê; billing:write é exigido para escrever', async () => {
      const charge = await createOk(a, {});
      await ctx.http().get(chargesUrl(a)).set(reader.auth).expect(200);
      await ctx.http().get(summaryUrl(a)).set(reader.auth).expect(200);

      await create(a, { patientId: patientA.id, description: 'x', amountCents: 100, dueDate: daysFromNow(1) }, reader).expect(403);
      await ctx.http().patch(chargesUrl(a, `/${charge.id}`)).set(reader.auth).send({ description: 'x' }).expect(403);
      await ctx.http().delete(chargesUrl(a, `/${charge.id}`)).set(reader.auth).expect(403);
      await pay(a, charge.id, { amountCents: 100, method: 'pix' }, reader).expect(403);
    });

    it('sem token é 401; token de outro tenant na URL é 403', async () => {
      await ctx.http().get(chargesUrl(a)).expect(401);
      await ctx.http().get(chargesUrl(a)).set(b.auth).expect(403);
      await ctx.http().get(summaryUrl(a)).set(b.auth).expect(403);
    });
  });
});
