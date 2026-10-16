import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type BillingCycle, type Plan, type TenantSubscription } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { todayIn } from '../common/validation/time-zone.js';
import { PaymentGateway, PaymentGatewayRejection, PaymentGatewayUnavailable } from './payment-gateway.js';
import {
  ANNUAL_DISCOUNT_PERCENT,
  annualPriceCents,
  subscriptionAccess,
  TRIAL_DAYS,
  TRIAL_PLAN_ID,
} from './subscription-access.js';
import type { ContractSubscriptionDto } from './dto/contract-subscription.dto.js';

// Webhook do Asaas (só o que importa aqui). Chega também para cobranças avulsas da conta, que
// não são de assinatura: essas são guardadas e ignoradas.
export interface AsaasWebhookPayload {
  id?: string;
  event?: string;
  payment?: {
    id?: string;
    subscription?: string;
    dueDate?: string;
    invoiceUrl?: string;
  };
}

// Pagamento confirmado (cartão aprovado) e recebido (dinheiro na conta: Pix, boleto, cartão
// depois do repasse). O cartão manda os dois para a mesma cobrança, e os dois liberam a clínica.
const PAID_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);

// Tempo de chamada ao Asaas dentro da transação: cliente + assinatura + primeira cobrança.
const CONTRACT_TX_TIMEOUT_MS = 60_000;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gateway: PaymentGateway,
    private readonly config: ConfigService,
  ) {}

  // Vitrine pública (landing, página de cadastro e tela de planos): preço mensal e anual já com
  // o desconto, para ninguém recalcular no front.
  async plans() {
    const plans = await this.prisma.plan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return {
      trialDays: TRIAL_DAYS,
      trialPlanId: TRIAL_PLAN_ID,
      annualDiscountPercent: ANNUAL_DISCOUNT_PERCENT,
      data: plans.map((plan) => this.planView(plan)),
    };
  }

  async view(tenantId: string) {
    const sub = await this.prisma.tenantSubscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub) {
      // Só a clínica-plataforma (backoffice) não tem assinatura.
      throw new NotFoundException('Esta clínica não tem assinatura');
    }
    return this.subscriptionView(sub);
  }

  // Contrata o plano: cria a assinatura no Asaas e devolve o link da primeira cobrança. A clínica
  // só passa a "ativa" quando o pagamento chega (webhook); até lá, vale o prazo do teste.
  async contract(tenantId: string, actor: AuthenticatedUser, dto: ContractSubscriptionDto) {
    if (!this.gateway.enabled()) {
      throw new ServiceUnavailableException('Contratação indisponível no momento; tente mais tarde');
    }
    const plan = await this.prisma.plan.findFirst({ where: { id: dto.planId, active: true } });
    if (!plan) {
      throw new BadRequestException('Plano inexistente');
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Um clique duplo não pode criar duas assinaturas (duas cobranças) no Asaas.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscription:${tenantId}`}))`;
          const current = await tx.tenantSubscription.findUnique({
            where: { tenantId },
            include: { tenant: { select: { timezone: true } } },
          });
          if (!current) {
            throw new NotFoundException('Esta clínica não tem assinatura');
          }
          if (current.asaasSubscriptionId) {
            throw new ConflictException('A clínica já contratou um plano');
          }

          const customerId = await this.gateway.upsertCustomer(
            { name: dto.billing.name, document: dto.billing.document, email: dto.billing.email, externalReference: tenantId },
            current.asaasCustomerId,
          );
          const valueCents = dto.cycle === 'yearly' ? annualPriceCents(plan.monthlyPriceCents) : plan.monthlyPriceCents;
          // Ainda no teste: a primeira cobrança vence no fim dele (contratar antes não encurta o
          // teste). Teste já acabado: vence hoje, no fuso da clínica.
          const today = todayIn(current.tenant.timezone);
          const trialEnd = todayIn(current.tenant.timezone, current.trialEndsAt);
          const firstDue = current.status === 'trialing' && trialEnd > today ? trialEnd : today;
          const asaasSubscriptionId = await this.gateway.createSubscription({
            customerId,
            method: dto.paymentMethod,
            valueCents,
            cycle: dto.cycle,
            firstDueDate: firstDue.toISOString().slice(0, 10),
            description: `Plano ${plan.name} (${dto.cycle === 'yearly' ? 'anual' : 'mensal'})`,
            externalReference: tenantId,
          });
          const payment = await this.gateway.firstPayment(asaasSubscriptionId);

          const updated = await tx.tenantSubscription.update({
            where: { tenantId },
            data: {
              planId: plan.id,
              cycle: dto.cycle,
              asaasCustomerId: customerId,
              asaasSubscriptionId,
              paymentUrl: payment?.invoiceUrl ?? null,
              billingName: dto.billing.name,
              billingDocument: dto.billing.document,
              billingEmail: dto.billing.email,
              contractedAt: new Date(),
            },
            include: { plan: true },
          });
          // Sem CPF/CNPJ nos detalhes: o registro de auditoria é imutável e lido por outros admins.
          await this.audit.record(
            actor,
            {
              action: 'subscription.contract',
              entityType: 'subscription',
              entityId: tenantId,
              details: { planId: plan.id, cycle: dto.cycle, paymentMethod: dto.paymentMethod, valueCents },
            },
            tx,
          );
          return this.subscriptionView(updated);
        },
        { timeout: CONTRACT_TX_TIMEOUT_MS },
      );
    } catch (error) {
      if (error instanceof PaymentGatewayRejection) {
        throw new BadRequestException(error.message || 'Dados de cobrança recusados pelo meio de pagamento');
      }
      if (error instanceof PaymentGatewayUnavailable) {
        throw new BadGatewayException('Não foi possível falar com o meio de pagamento; tente de novo');
      }
      throw error;
    }
  }

  // Webhook do Asaas. A entrega é "pelo menos uma vez": o id do evento é a chave da tabela, e o
  // evento repetido é confirmado sem reprocessar. Evento e efeito entram na mesma transação: se o
  // efeito falhar, o Asaas reenvia e o evento é processado de novo.
  async handleWebhook(token: string | undefined, payload: AsaasWebhookPayload) {
    if (!this.validWebhookToken(token)) {
      throw new UnauthorizedException();
    }
    if (!payload?.id || !payload.event) {
      throw new BadRequestException('Evento sem id');
    }
    const eventId = payload.id;
    const event = payload.event;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.asaasWebhookEvent.create({
          data: { id: eventId, event, payload: payload as Prisma.InputJsonValue },
        });
        const subscriptionId = payload.payment?.subscription;
        if (!subscriptionId) {
          return;
        }
        const sub = await tx.tenantSubscription.findUnique({ where: { asaasSubscriptionId: subscriptionId } });
        if (!sub) {
          this.logger.warn(`Webhook ${event} de assinatura desconhecida (${subscriptionId})`);
          return;
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscription:${sub.tenantId}`}))`;
        const fresh = await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId: sub.tenantId } });
        const data = this.webhookEffect(fresh, event, payload.payment ?? {});
        if (data) {
          await tx.tenantSubscription.update({ where: { tenantId: sub.tenantId }, data });
        }
        await tx.asaasWebhookEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
      });
    } catch (error) {
      // Evento já recebido: o Asaas reenviou. Confirma para ele parar de reenviar.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { received: true };
      }
      throw error;
    }
    return { received: true };
  }

  private webhookEffect(
    sub: TenantSubscription,
    event: string,
    payment: NonNullable<AsaasWebhookPayload['payment']>,
  ): Prisma.TenantSubscriptionUpdateInput | null {
    if (PAID_EVENTS.has(event)) {
      // Pago até o vencimento da cobrança + um ciclo. Pelo vencimento (e não "somar um ciclo ao
      // que já tinha") para CONFIRMED e RECEIVED da mesma cobrança não contarem dois períodos.
      const due = payment.dueDate ? new Date(`${payment.dueDate}T00:00:00.000Z`) : new Date();
      const periodEnd = addCycle(due, sub.cycle);
      const currentPeriodEnd = sub.currentPeriodEnd && sub.currentPeriodEnd > periodEnd ? sub.currentPeriodEnd : periodEnd;
      return { status: 'active', pastDueSince: null, currentPeriodEnd };
    }
    // Atraso só conta para quem já pagou alguma vez: no teste, quem manda é o prazo do teste.
    if (event === 'PAYMENT_OVERDUE' && sub.status === 'active') {
      return { status: 'past_due', pastDueSince: new Date() };
    }
    // Cobrança nova do ciclo seguinte: o link que a tela de assinatura mostra passa a ser o dela.
    if (event === 'PAYMENT_CREATED' && payment.invoiceUrl) {
      return { paymentUrl: payment.invoiceUrl };
    }
    return null;
  }

  private validWebhookToken(token: string | undefined): boolean {
    const expected = this.config.get<string>('ASAAS_WEBHOOK_TOKEN')?.trim();
    // Sem token configurado, nenhum webhook é aceito (não dá para saber se veio do Asaas).
    if (!expected || !token) {
      return false;
    }
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private planView(plan: Plan) {
    return {
      id: plan.id,
      name: plan.name,
      monthlyPriceCents: plan.monthlyPriceCents,
      annualPriceCents: annualPriceCents(plan.monthlyPriceCents),
      maxProfessionals: plan.maxProfessionals,
      extraProfessionalCents: plan.extraProfessionalCents,
      monthlyReminders: plan.monthlyReminders,
      monthlyBotBookings: plan.monthlyBotBookings,
      monthlyCampaignMessages: plan.monthlyCampaignMessages,
    };
  }

  private subscriptionView(sub: TenantSubscription & { plan: Plan }) {
    const state = subscriptionAccess(sub);
    return {
      plan: this.planView(sub.plan),
      status: sub.status,
      cycle: sub.cycle,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      pastDueSince: sub.pastDueSince,
      contracted: Boolean(sub.asaasSubscriptionId),
      contractedAt: sub.contractedAt,
      paymentUrl: sub.paymentUrl,
      billing: sub.billingDocument
        ? { name: sub.billingName, document: sub.billingDocument, email: sub.billingEmail }
        : null,
      ...state,
    };
  }
}

function addCycle(date: Date, cycle: BillingCycle): Date {
  const next = new Date(date);
  if (cycle === 'yearly') {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}
