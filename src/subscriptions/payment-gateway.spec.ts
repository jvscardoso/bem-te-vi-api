import type { ConfigService } from '@nestjs/config';
import { AsaasPaymentGateway, PaymentGatewayRejection, PaymentGatewayUnavailable } from './payment-gateway.js';

function gateway(env: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    ASAAS_API_URL: 'https://api-sandbox.asaas.com/v3',
    ASAAS_API_KEY: '$aact_hmlg_chave',
    ...env,
  };
  const config = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key] ?? (() => { throw new Error(key); })(),
  } as unknown as ConfigService;
  return new AsaasPaymentGateway(config);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('AsaasPaymentGateway', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sem chave, fica desligado', () => {
    expect(gateway({ ASAAS_API_KEY: '' }).enabled()).toBe(false);
    expect(gateway().enabled()).toBe(true);
  });

  it('cria a assinatura com a chave no header access_token, valor em reais e o ciclo do Asaas', async () => {
    const fetchMock = vi.fn(async () => json(200, { id: 'sub_123' }));
    vi.stubGlobal('fetch', fetchMock);

    const id = await gateway().createSubscription({
      customerId: 'cus_1',
      method: 'any',
      valueCents: 160920,
      cycle: 'yearly',
      firstDueDate: '2026-10-15',
      description: 'bem-te-vi · Essencial (anual)',
      externalReference: 'tenant-1',
    });

    expect(id).toBe('sub_123');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api-sandbox.asaas.com/v3/subscriptions');
    expect((init.headers as Record<string, string>).access_token).toBe('$aact_hmlg_chave');
    expect(JSON.parse(init.body as string)).toEqual({
      customer: 'cus_1',
      billingType: 'UNDEFINED',
      value: 1609.2,
      nextDueDate: '2026-10-15',
      cycle: 'YEARLY',
      description: 'bem-te-vi · Essencial (anual)',
      externalReference: 'tenant-1',
    });
  });

  it('cliente existente é atualizado no próprio id', async () => {
    const fetchMock = vi.fn(async () => json(200, { id: 'cus_9' }));
    vi.stubGlobal('fetch', fetchMock);
    await gateway().upsertCustomer({ name: 'C', document: '52998224725', email: 'a@b.com', externalReference: 't' }, 'cus_9');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api-sandbox.asaas.com/v3/customers/cus_9');
  });

  it('400 com erros do Asaas vira recusa com a descrição; outras falhas, erro genérico', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { errors: [{ code: 'invalid_cpfCnpj', description: 'CPF inválido.' }] })));
    await expect(gateway().upsertCustomer({ name: 'C', document: '1', email: 'a@b.com', externalReference: 't' }, null)).rejects.toEqual(
      new PaymentGatewayRejection('CPF inválido.'),
    );

    vi.stubGlobal('fetch', vi.fn(async () => json(500, {})));
    await expect(gateway().firstPayment('sub_1')).rejects.toBeInstanceOf(PaymentGatewayUnavailable);
  });

  it('primeira cobrança: o link de pagamento da cobrança da assinatura', async () => {
    const fetchMock = vi.fn(async () => json(200, { data: [{ id: 'pay_1', invoiceUrl: 'https://sandbox.asaas.com/i/pay_1' }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await gateway().firstPayment('sub_1')).toEqual({ id: 'pay_1', invoiceUrl: 'https://sandbox.asaas.com/i/pay_1' });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api-sandbox.asaas.com/v3/payments?subscription=sub_1&limit=1');
  });
});
