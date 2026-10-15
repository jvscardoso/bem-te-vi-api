import {
  LEGAL,
  PASSWORD,
  cleanupTenants,
  createPatient,
  createTestApp,
  createUser,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';
import { todayIn } from '../src/common/validation/time-zone.js';

// Fuso da clínica: configuração, /auth/me e o "hoje" do financeiro (atraso de cobrança).
describe('Fuso horário da clínica (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  const created: string[] = [];

  const tenantUrl = () => `/tenants/${a.tenantId}`;
  const setTimezone = (timezone: string) => ctx.http().patch(tenantUrl()).set(a.auth).send({ timezone });

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'fuso');
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, ...created]);
    await ctx.app.close();
  });

  it('clínica nova nasce em America/Sao_Paulo', async () => {
    const res = await ctx.http().get(tenantUrl()).set(a.auth).expect(200);
    expect(res.body.timezone).toBe('America/Sao_Paulo');
  });

  it('aceita fuso IANA e grava o nome canônico', async () => {
    const res = await setTimezone('america/manaus').expect(200);
    expect(res.body.timezone).toBe('America/Manaus');
  });

  it.each(['-03:00', 'GMT-3', 'Brasil/Brasilia', 'UTC', ''])('recusa %j (400, em português)', async (timezone) => {
    const res = await setTimezone(timezone).expect(400);
    expect(res.body.errors[0].field).toBe('timezone');
  });

  it('a mensagem de fuso inválido explica o formato', async () => {
    const res = await setTimezone('Lua/Base_Alfa').expect(400);
    expect(res.body.message).toEqual(['Fuso horário inválido: use um nome IANA, como America/Sao_Paulo']);
  });

  it('o cadastro de clínica também aceita o fuso', async () => {
    const suffix = uniq();
    const res = await ctx
      .http()
      .post('/tenants')
      .send({
        name: `Clinica Fuso ${suffix}`,
        subdomain: `fuso-${suffix}`,
        timezone: 'america/rio_branco',
        owner: { name: 'Dona', email: `dona-fuso-${suffix}@teste.com`, password: PASSWORD },
        legalAcceptance: LEGAL,
      })
      .expect(201);
    created.push(res.body.tenant.id);
    expect(res.body.tenant.timezone).toBe('America/Rio_Branco');
  });

  it('GET /auth/me traz o fuso da clínica para qualquer usuário', async () => {
    await setTimezone('America/Noronha').expect(200);
    const user = await createUser(ctx.http, a, 'fuso-usuario');
    const me = await ctx.http().get('/auth/me').set(user.auth).expect(200);
    expect(me.body.timezone).toBe('America/Noronha');
  });

  // Dois fusos com mais de 24 h de diferença: o "hoje" de um é sempre o "ontem" do outro. Uma
  // cobrança que vence no "hoje" do fuso atrasado está em dia lá e atrasada no adiantado.
  it('atraso de cobrança usa o "hoje" do fuso da clínica', async () => {
    const behind = 'Pacific/Pago_Pago'; // UTC-11
    const ahead = 'Pacific/Kiritimati'; // UTC+14
    const patient = await createPatient(ctx.http, a);
    const dueDate = todayIn(behind).toISOString().slice(0, 10);
    const charge = await ctx
      .http()
      .post(`${tenantUrl()}/charges`)
      .set(a.auth)
      .send({ patientId: patient.id, description: 'Consulta', amountCents: 10000, dueDate })
      .expect(201);
    const isOverdue = async () =>
      (await ctx.http().get(`${tenantUrl()}/charges/${charge.body.id}`).set(a.auth).expect(200)).body.isOverdue;
    const overdueIds = async () =>
      (await ctx.http().get(`${tenantUrl()}/charges`).query({ status: 'overdue' }).set(a.auth).expect(200)).body.data.map(
        (c: { id: string }) => c.id,
      );

    await setTimezone(behind).expect(200);
    expect(await isOverdue()).toBe(false);
    expect(await overdueIds()).not.toContain(charge.body.id);

    await setTimezone(ahead).expect(200);
    expect(await isOverdue()).toBe(true);
    expect(await overdueIds()).toContain(charge.body.id);
    const summary = await ctx.http().get(`${tenantUrl()}/billing/summary`).set(a.auth).expect(200);
    expect(summary.body.overdue.count).toBe(1);
  });
});
