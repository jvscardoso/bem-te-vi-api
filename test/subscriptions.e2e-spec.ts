import { randomUUID } from 'node:crypto';
import {
  cleanupTenants,
  createPatient,
  createPlatformAdmin,
  createTestApp,
  createUser,
  FakePaymentGateway,
  permissionIds,
  signupTenant,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

const DAY = 24 * 60 * 60 * 1000;
const WEBHOOK_TOKEN = 'token-do-webhook-de-teste';
const BILLING = { name: 'Clínica Teste LTDA', document: '11.222.333/0001-81', email: 'Financeiro@Clinica.com' };

// Assinatura da clínica (decisão 11, task 29): teste grátis, contratação no Asaas (dublê),
// webhook e o modo só leitura/bloqueado.
describe('Assinatura (e2e)', () => {
  let ctx: TestApp;
  let gateway: FakePaymentGateway;
  const tenants: (string | undefined)[] = [];
  let previousToken: string | undefined;

  beforeAll(async () => {
    previousToken = process.env.ASAAS_WEBHOOK_TOKEN;
    process.env.ASAAS_WEBHOOK_TOKEN = WEBHOOK_TOKEN;
    gateway = new FakePaymentGateway();
    ctx = await createTestApp({ paymentGateway: gateway });
  });

  afterAll(async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = previousToken;
    await cleanupTenants(ctx.prisma, tenants);
    await ctx.app.close();
  });

  afterEach(() => {
    gateway.isEnabled = true;
    gateway.reject = null;
    gateway.fail = false;
  });

  async function signup(label: string) {
    const tenant = await signupTenant(ctx.http, label);
    tenants.push(tenant.tenantId);
    return tenant;
  }

  const contract = (t: TestTenant, body: Record<string, unknown> = {}) =>
    ctx.http()
      .post(`/tenants/${t.tenantId}/subscription`)
      .set(t.auth)
      .send({ planId: 'essencial', cycle: 'monthly', paymentMethod: 'any', billing: BILLING, ...body });

  const webhook = (body: Record<string, unknown>, token: string | null = WEBHOOK_TOKEN) => {
    const req = ctx.http().post('/webhooks/asaas');
    return (token ? req.set('asaas-access-token', token) : req).send(body);
  };

  const paymentEvent = (event: string, subscription: string, payment: Record<string, unknown> = {}) => ({
    id: `evt_${randomUUID()}`,
    event,
    payment: { id: `pay_${randomUUID()}`, subscription, dueDate: '2026-11-10', ...payment },
  });

  const setSubscription = (tenantId: string, data: Record<string, unknown>) =>
    ctx.prisma.tenantSubscription.update({ where: { tenantId }, data });

  describe('planos', () => {
    it('GET /public/plans é público e traz o preço anual com 10% de desconto', async () => {
      const res = await ctx.http().get('/public/plans').expect(200);
      expect(res.body).toMatchObject({ trialDays: 14, trialPlanId: 'essencial', annualDiscountPercent: 10 });
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual(['individual', 'essencial', 'profissional', 'completo']);
      expect(res.body.data[1]).toMatchObject({
        name: 'Essencial',
        monthlyPriceCents: 14900,
        annualPriceCents: 160920,
        maxProfessionals: 5,
        monthlyReminders: 500,
      });
    });
  });

  describe('teste grátis', () => {
    it('o cadastro começa em teste de 14 dias no Essencial, visível no /auth/me de todo usuário', async () => {
      const a = await signup('assin-trial');
      const sub = await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
      expect(sub).toMatchObject({ planId: 'essencial', status: 'trialing', asaasSubscriptionId: null });
      const days = (sub.trialEndsAt.getTime() - Date.now()) / DAY;
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThanOrEqual(14);

      const me = await ctx.http().get('/auth/me').set(a.auth).expect(200);
      expect(me.body.subscription).toMatchObject({ planId: 'essencial', status: 'trialing', access: 'full', reason: null });
      expect(new Date(me.body.subscription.changesAt).getTime()).toBe(sub.trialEndsAt.getTime());

      const view = await ctx.http().get(`/tenants/${a.tenantId}/subscription`).set(a.auth).expect(200);
      expect(view.body).toMatchObject({
        status: 'trialing',
        contracted: false,
        paymentUrl: null,
        billing: null,
        access: 'full',
        plan: { id: 'essencial', annualPriceCents: 160920 },
      });
    });

    it('ver e contratar exigem tenant:manage, e só na própria clínica', async () => {
      const a = await signup('assin-perm-a');
      const b = await signup('assin-perm-b');
      const [readId] = await permissionIds(ctx.prisma, ['patients:read']);
      const role = await ctx.prisma.role.create({
        data: { tenantId: a.tenantId, name: `Recepção ${randomUUID().slice(0, 6)}`, permissions: { create: [{ permissionId: readId }] } },
      });
      const receptionist = await createUser(ctx.http, a, 'recepcao-assin', { roleId: role.id });

      await ctx.http().get(`/tenants/${a.tenantId}/subscription`).set(receptionist.auth).expect(403);
      await contract({ ...a, auth: receptionist.auth }).expect(403);
      await ctx.http().get(`/tenants/${b.tenantId}/subscription`).set(a.auth).expect(403);
      await contract({ ...b, auth: a.auth }).expect(403);
      // A recepção também vê o estado da assinatura (para o aviso), pelo /auth/me.
      const me = await ctx.http().get('/auth/me').set(receptionist.auth).expect(200);
      expect(me.body.subscription.status).toBe('trialing');
    });
  });

  describe('contratação', () => {
    it('valida plano, ciclo, forma de pagamento e CPF/CNPJ', async () => {
      const a = await signup('assin-valid');
      const res = await contract(a, { planId: 'essencial', cycle: 'weekly', paymentMethod: 'cash', billing: { ...BILLING, document: '123' } }).expect(400);
      expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['billing.document', 'cycle', 'paymentMethod']);
      await contract(a, { planId: 'premium' }).expect(400);
      expect(gateway.subscriptions.filter((s) => s.externalReference === a.tenantId)).toHaveLength(0);
    });

    it('cria cliente e assinatura no Asaas, com a 1ª cobrança no fim do teste, e devolve o link', async () => {
      const a = await signup('assin-contrata');
      const res = await contract(a, { planId: 'profissional', cycle: 'yearly', paymentMethod: 'pix' }).expect(201);

      expect(res.body).toMatchObject({
        status: 'trialing',
        cycle: 'yearly',
        contracted: true,
        plan: { id: 'profissional' },
        billing: { name: BILLING.name, document: '11222333000181', email: 'financeiro@clinica.com' },
        access: 'full',
      });
      expect(res.body.paymentUrl).toMatch(/^https:\/\/sandbox\.asaas\.com\/i\/sub_/);

      const customer = gateway.customers.find((c) => c.externalReference === a.tenantId);
      expect(customer).toMatchObject({ document: '11222333000181', email: 'financeiro@clinica.com' });
      const sent = gateway.subscriptions.find((s) => s.externalReference === a.tenantId)!;
      const sub = await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
      expect(sent).toMatchObject({ customerId: customer!.id, method: 'pix', cycle: 'yearly', valueCents: 322920 });
      // Fuso padrão da clínica: America/Sao_Paulo.
      const trialEndLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(sub.trialEndsAt);
      expect(sent.firstDueDate).toBe(trialEndLocal);
      expect(sub).toMatchObject({ asaasCustomerId: customer!.id, asaasSubscriptionId: sent.id, planId: 'profissional' });

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { tenantId: a.tenantId, action: 'subscription.contract' } });
      expect(audit.details).toEqual({ planId: 'profissional', cycle: 'yearly', paymentMethod: 'pix', valueCents: 322920 });

      // Contratar de novo: 409, sem segunda assinatura no Asaas.
      await contract(a).expect(409);
      expect(gateway.subscriptions.filter((s) => s.externalReference === a.tenantId)).toHaveLength(1);
    });

    it('teste já vencido: a 1ª cobrança vence hoje', async () => {
      const a = await signup('assin-vencido');
      await setSubscription(a.tenantId, { trialEndsAt: new Date(Date.now() - 3 * DAY) });
      await contract(a).expect(201);
      const sent = gateway.subscriptions.find((s) => s.externalReference === a.tenantId)!;
      expect(sent.firstDueDate).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()));
      expect(sent.valueCents).toBe(14900);
    });

    it('clique duplo: só uma assinatura no Asaas', async () => {
      const a = await signup('assin-corrida');
      const results = await Promise.all([contract(a), contract(a), contract(a)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(gateway.subscriptions.filter((s) => s.externalReference === a.tenantId)).toHaveLength(1);
    });

    it('Asaas sem chave: 503; recusa do Asaas: 400 com a mensagem; Asaas fora do ar: 502', async () => {
      const a = await signup('assin-erros');
      gateway.isEnabled = false;
      await contract(a).expect(503);
      gateway.isEnabled = true;
      gateway.reject = 'O CPF/CNPJ informado é inválido.';
      const rejected = await contract(a).expect(400);
      expect(rejected.body.message).toBe('O CPF/CNPJ informado é inválido.');
      gateway.reject = null;
      gateway.fail = true;
      await contract(a).expect(502);
      const sub = await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
      expect(sub.asaasSubscriptionId).toBeNull();
    });
  });

  describe('webhook do Asaas', () => {
    let a: TestTenant;
    let asaasId: string;

    beforeAll(async () => {
      a = await signup('assin-webhook');
      await contract(a).expect(201);
      asaasId = (await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } })).asaasSubscriptionId!;
    });

    it('sem o token certo: 401, e nada é gravado', async () => {
      const event = paymentEvent('PAYMENT_CONFIRMED', asaasId);
      await webhook(event, null).expect(401);
      await webhook(event, 'token-errado').expect(401);
      expect(await ctx.prisma.asaasWebhookEvent.findUnique({ where: { id: event.id } })).toBeNull();
    });

    it('pagamento confirmado ativa a clínica até o vencimento + 1 ciclo; evento repetido não reprocessa', async () => {
      const paymentId = `pay_${randomUUID()}`;
      const confirmed = paymentEvent('PAYMENT_CONFIRMED', asaasId, { id: paymentId });
      await webhook(confirmed).expect(200, { received: true });
      let sub = await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
      expect(sub.status).toBe('active');
      expect(sub.currentPeriodEnd?.toISOString()).toBe('2026-12-10T00:00:00.000Z');
      expect((await ctx.prisma.asaasWebhookEvent.findUniqueOrThrow({ where: { id: confirmed.id } })).processedAt).not.toBeNull();

      // Reenvio do mesmo evento e RECEIVED da mesma cobrança: o período não anda de novo.
      await webhook(confirmed).expect(200);
      await webhook(paymentEvent('PAYMENT_RECEIVED', asaasId, { id: paymentId })).expect(200);
      sub = await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
      expect(sub.currentPeriodEnd?.toISOString()).toBe('2026-12-10T00:00:00.000Z');

      const me = await ctx.http().get('/auth/me').set(a.auth).expect(200);
      expect(me.body.subscription).toMatchObject({ status: 'active', access: 'full', reason: null, changesAt: null });
    });

    it('cobrança nova troca o link; atraso marca past_due; pagamento tira do atraso', async () => {
      await webhook(paymentEvent('PAYMENT_CREATED', asaasId, { invoiceUrl: 'https://sandbox.asaas.com/i/nova' })).expect(200);
      let sub = await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
      expect(sub.paymentUrl).toBe('https://sandbox.asaas.com/i/nova');

      await webhook(paymentEvent('PAYMENT_OVERDUE', asaasId, { dueDate: '2026-12-10' })).expect(200);
      sub = await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
      expect(sub.status).toBe('past_due');
      expect(sub.pastDueSince).not.toBeNull();
      // Na carência: segue usando tudo, com o aviso.
      const me = await ctx.http().get('/auth/me').set(a.auth).expect(200);
      expect(me.body.subscription).toMatchObject({ status: 'past_due', access: 'full', reason: 'past_due' });
      await createPatient(ctx.http, a);

      await webhook(paymentEvent('PAYMENT_RECEIVED', asaasId, { dueDate: '2026-12-10' })).expect(200);
      sub = await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
      expect(sub).toMatchObject({ status: 'active', pastDueSince: null });
      expect(sub.currentPeriodEnd?.toISOString()).toBe('2027-01-10T00:00:00.000Z');
    });

    it('atraso durante o teste não muda nada (vale o prazo do teste)', async () => {
      const b = await signup('assin-webhook-trial');
      await contract(b).expect(201);
      const sub = await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: b.tenantId } });
      await webhook(paymentEvent('PAYMENT_OVERDUE', sub.asaasSubscriptionId!)).expect(200);
      expect((await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: b.tenantId } })).status).toBe('trialing');
    });

    it('evento de cobrança fora de assinatura, ou de assinatura desconhecida: 200 e ignorado', async () => {
      await webhook({ id: `evt_${randomUUID()}`, event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_avulso' } }).expect(200);
      await webhook(paymentEvent('PAYMENT_CONFIRMED', 'sub_que_nao_existe')).expect(200);
      await webhook({ event: 'PAYMENT_CONFIRMED' }).expect(400);
    });
  });

  describe('só leitura e bloqueio', () => {
    it('teste vencido: só leitura (GET passa, escrita 402), contratação e saída liberadas', async () => {
      const a = await signup('assin-leitura');
      const patient = await createPatient(ctx.http, a);
      await setSubscription(a.tenantId, { trialEndsAt: new Date(Date.now() - DAY) });

      await ctx.http().get(`/tenants/${a.tenantId}/patients`).set(a.auth).expect(200);
      const denied = await ctx.http()
        .post(`/tenants/${a.tenantId}/patients`)
        .set(a.auth)
        .send({ fullName: 'Paciente Novo' })
        .expect(402);
      expect(denied.body).toMatchObject({ statusCode: 402, error: 'Payment Required', code: 'subscription_read_only' });
      await ctx.http().patch(`/tenants/${a.tenantId}/patients/${patient.id}`).set(a.auth).send({ fullName: 'Outro' }).expect(402);

      const me = await ctx.http().get('/auth/me').set(a.auth).expect(200);
      expect(me.body.subscription).toMatchObject({ access: 'read_only', reason: 'trial_ended' });
      await ctx.http().post(`/tenants/${a.tenantId}/closure`).set(a.auth).send({ password: 'errada' }).expect(400);
      await contract(a).expect(201);
      // Contratar não libera sozinho: só o pagamento (webhook).
      await ctx.http().post(`/tenants/${a.tenantId}/patients`).set(a.auth).send({ fullName: 'Paciente Novo' }).expect(402);
    });

    it('30 dias depois: bloqueada (nem leitura), mas exporta, encerra, contrata e usa /auth', async () => {
      const a = await signup('assin-bloqueio');
      const patient = await createPatient(ctx.http, a);
      await setSubscription(a.tenantId, { trialEndsAt: new Date(Date.now() - 31 * DAY) });

      const denied = await ctx.http().get(`/tenants/${a.tenantId}/patients`).set(a.auth).expect(402);
      expect(denied.body.code).toBe('subscription_blocked');
      await ctx.http().get(`/tenants/${a.tenantId}`).set(a.auth).expect(402);

      await ctx.http().get('/auth/me').set(a.auth).expect(200);
      await ctx.http().get(`/tenants/${a.tenantId}/subscription`).set(a.auth).expect(200);
      await ctx.http().get(`/tenants/${a.tenantId}/export`).set(a.auth).expect(200);
      await ctx.http().get(`/tenants/${a.tenantId}/patients/${patient.id}/export`).set(a.auth).expect(200);
      await ctx.http().get(`/tenants/${a.tenantId}/closure`).set(a.auth).expect(200);
      await ctx.http().post('/auth/logout').set(a.auth).expect((res) => expect(res.status).toBeLessThan(300));
    });

    it('pagamento confirmado depois do bloqueio devolve o acesso na hora', async () => {
      const a = await signup('assin-volta');
      await setSubscription(a.tenantId, { trialEndsAt: new Date(Date.now() - 40 * DAY) });
      await contract(a).expect(201);
      const sub = await ctx.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
      await ctx.http().get(`/tenants/${a.tenantId}/patients`).set(a.auth).expect(402);
      await webhook(paymentEvent('PAYMENT_RECEIVED', sub.asaasSubscriptionId!)).expect(200);
      await ctx.http().get(`/tenants/${a.tenantId}/patients`).set(a.auth).expect(200);
      await createPatient(ctx.http, a);
    });

    it('atraso além da carência de 7 dias: só leitura', async () => {
      const a = await signup('assin-atraso');
      await setSubscription(a.tenantId, { status: 'past_due', pastDueSince: new Date(Date.now() - 8 * DAY) });
      const res = await ctx.http().post(`/tenants/${a.tenantId}/patients`).set(a.auth).send({ fullName: 'X' }).expect(402);
      expect(res.body.code).toBe('subscription_read_only');
      const me = await ctx.http().get('/auth/me').set(a.auth).expect(200);
      expect(me.body.subscription).toMatchObject({ access: 'read_only', reason: 'past_due' });
    });

    it('a clínica-plataforma não tem assinatura e não é afetada; o painel mostra a assinatura das clínicas', async () => {
      const platform = await createPlatformAdmin(ctx);
      tenants.push(platform.tenantId);
      const a = await signup('assin-painel');
      await setSubscription(a.tenantId, { trialEndsAt: new Date(Date.now() - DAY) });

      const me = await ctx.http().get('/auth/me').set(platform.auth).expect(200);
      expect(me.body.subscription).toBeNull();
      const list = await ctx.http().get('/platform/tenants').query({ q: 'assin-painel' }).set(platform.auth).expect(200);
      const row = list.body.data.find((t: { id: string }) => t.id === a.tenantId);
      expect(row.subscription).toMatchObject({ planId: 'essencial', status: 'trialing', access: 'read_only', reason: 'trial_ended' });
      expect(row.subscription).not.toHaveProperty('billingDocument');
    });
  });
});
