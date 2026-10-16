import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PaymentMethod = 'pix' | 'boleto' | 'credit_card' | 'any';
export type GatewayCycle = 'monthly' | 'yearly';

export interface GatewayCustomer {
  name: string;
  // CPF ou CNPJ, só dígitos.
  document: string;
  email: string;
  // Id da clínica: liga o cliente do gateway à clínica, para conferência no painel.
  externalReference: string;
}

export interface GatewaySubscription {
  customerId: string;
  method: PaymentMethod;
  valueCents: number;
  cycle: GatewayCycle;
  // Vencimento da primeira cobrança (AAAA-MM-DD).
  firstDueDate: string;
  description: string;
  externalReference: string;
}

export interface GatewayPayment {
  id: string;
  // Página de pagamento (Pix, boleto ou cartão) que a clínica abre.
  invoiceUrl: string;
}

// Recusa do gateway por dado do cliente (ex.: CPF que o Asaas não aceita). Vira 400 com a mensagem
// do gateway; qualquer outra falha (rede, fora do ar) vira 502.
export class PaymentGatewayRejection extends Error {}
export class PaymentGatewayUnavailable extends Error {}

// Gateway de pagamento das mensalidades. Plugável, como EmailSender e JobQueue: a implementação é
// o Asaas (decisão 11), e os testes usam um dublê. O cartão nunca passa por aqui: a clínica paga
// na página do próprio gateway (invoiceUrl), o que deixa a plataforma fora do escopo de PCI.
export abstract class PaymentGateway {
  // Sem credencial configurada, a contratação fica indisponível (503); o resto da API funciona.
  abstract enabled(): boolean;
  // Cria o cliente, ou atualiza o que já existe (existingId), e devolve o id dele.
  abstract upsertCustomer(customer: GatewayCustomer, existingId: string | null): Promise<string>;
  abstract createSubscription(subscription: GatewaySubscription): Promise<string>;
  // A primeira cobrança gerada pela assinatura, com o link de pagamento.
  abstract firstPayment(subscriptionId: string): Promise<GatewayPayment | null>;
}

const BILLING_TYPE: Record<PaymentMethod, string> = {
  pix: 'PIX',
  boleto: 'BOLETO',
  credit_card: 'CREDIT_CARD',
  // A clínica escolhe na página do Asaas.
  any: 'UNDEFINED',
};

const TIMEOUT_MS = 15_000;

// API v3 do Asaas. A chave vai no header `access_token` (não é Bearer); valores em reais.
@Injectable()
export class AsaasPaymentGateway extends PaymentGateway {
  private readonly logger = new Logger(AsaasPaymentGateway.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  enabled() {
    return Boolean(this.config.get<string>('ASAAS_API_KEY')?.trim());
  }

  async upsertCustomer(customer: GatewayCustomer, existingId: string | null): Promise<string> {
    const body = {
      name: customer.name,
      cpfCnpj: customer.document,
      email: customer.email,
      externalReference: customer.externalReference,
    };
    const result = await this.request<{ id: string }>('POST', existingId ? `/customers/${existingId}` : '/customers', body);
    return result.id;
  }

  async createSubscription(subscription: GatewaySubscription): Promise<string> {
    const result = await this.request<{ id: string }>('POST', '/subscriptions', {
      customer: subscription.customerId,
      billingType: BILLING_TYPE[subscription.method],
      value: subscription.valueCents / 100,
      nextDueDate: subscription.firstDueDate,
      cycle: subscription.cycle === 'yearly' ? 'YEARLY' : 'MONTHLY',
      description: subscription.description,
      externalReference: subscription.externalReference,
    });
    return result.id;
  }

  async firstPayment(subscriptionId: string): Promise<GatewayPayment | null> {
    const result = await this.request<{ data: { id: string; invoiceUrl: string }[] }>(
      'GET',
      `/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=1`,
    );
    const [payment] = result.data ?? [];
    return payment ? { id: payment.id, invoiceUrl: payment.invoiceUrl } : null;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    const baseUrl = (this.config.get<string>('ASAAS_API_URL')?.trim() || 'https://api-sandbox.asaas.com/v3').replace(/\/+$/, '');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          access_token: this.config.getOrThrow<string>('ASAAS_API_KEY').trim(),
          'Content-Type': 'application/json',
          'User-Agent': 'bem-te-vi-api',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`Asaas ${method} ${path} falhou: ${error instanceof Error ? error.message : String(error)}`);
      throw new PaymentGatewayUnavailable('Asaas indisponível');
    }
    const payload = (await response.json().catch(() => null)) as (T & { errors?: { description?: string }[] }) | null;
    if (response.status === 400 && payload?.errors?.length) {
      throw new PaymentGatewayRejection(payload.errors.map((e) => e.description).filter(Boolean).join('; '));
    }
    if (!response.ok || !payload) {
      // Sem o corpo no log: pode ter dado de cobrança da clínica.
      this.logger.error(`Asaas ${method} ${path} respondeu ${response.status}`);
      throw new PaymentGatewayUnavailable(`Asaas respondeu ${response.status}`);
    }
    return payload;
  }
}
