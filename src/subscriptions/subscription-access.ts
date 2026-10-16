import type { Prisma, SubscriptionStatus } from '@prisma/client';

// Regras da assinatura (decisão 11). Num lugar só, para a regra e os textos não se espalharem.
export const TRIAL_PLAN_ID = 'essencial';
export const TRIAL_DAYS = 14;
// Cobrança vencida: a clínica segue usando normalmente por este prazo (aviso), depois só leitura.
export const PAST_DUE_GRACE_DAYS = 7;
// Depois do teste sem contratar, ou depois da carência de atraso: dá para ver e exportar os dados
// por este prazo (LGPD: a clínica não perde o acesso aos próprios dados de uma hora para outra).
export const READ_ONLY_DAYS = 30;
export const ANNUAL_DISCOUNT_PERCENT = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

// full: usa tudo · read_only: só lê (e exporta, e contrata) · blocked: só contrata e exporta.
export type SubscriptionAccess = 'full' | 'read_only' | 'blocked';

export interface SubscriptionAccessState {
  access: SubscriptionAccess;
  // Por que a clínica não tem acesso completo: teste acabou ou cobrança vencida.
  reason: 'trial_ended' | 'past_due' | null;
  // Quando o acesso muda para o próximo estado (null = não muda sozinho).
  changesAt: Date | null;
}

export interface SubscriptionTiming {
  status: SubscriptionStatus;
  trialEndsAt: Date;
  pastDueSince: Date | null;
}

// O acesso sai da assinatura e do relógio, na hora: não há job que precise rodar à meia-noite
// para a clínica virar "só leitura", nem estado guardado que possa ficar velho.
// Sem assinatura (a clínica-plataforma do backoffice): acesso completo.
export function subscriptionAccess(sub: SubscriptionTiming | null, now = new Date()): SubscriptionAccessState {
  if (!sub || sub.status === 'active') {
    return { access: 'full', reason: null, changesAt: null };
  }
  // Em teste (mesmo já tendo contratado, enquanto o primeiro pagamento não chega), o prazo é o do
  // teste. Em atraso, conta a partir da carência.
  const fullUntil =
    sub.status === 'trialing'
      ? sub.trialEndsAt
      : new Date((sub.pastDueSince ?? now).getTime() + PAST_DUE_GRACE_DAYS * DAY_MS);
  const reason = sub.status === 'trialing' ? 'trial_ended' : 'past_due';
  if (now < fullUntil) {
    return { access: 'full', reason: sub.status === 'past_due' ? 'past_due' : null, changesAt: fullUntil };
  }
  const readOnlyUntil = new Date(fullUntil.getTime() + READ_ONLY_DAYS * DAY_MS);
  if (now < readOnlyUntil) {
    return { access: 'read_only', reason, changesAt: readOnlyUntil };
  }
  return { access: 'blocked', reason, changesAt: null };
}

// Preço anual: 12 meses com o desconto, arredondado ao centavo.
export function annualPriceCents(monthlyPriceCents: number): number {
  return Math.round((monthlyPriceCents * 12 * (100 - ANNUAL_DISCOUNT_PERCENT)) / 100);
}

export function trialEndsAt(from = new Date()): Date {
  return new Date(from.getTime() + TRIAL_DAYS * DAY_MS);
}

// Assinatura de clínica recém-cadastrada: teste grátis, sem cartão. Na transação do cadastro,
// para não existir clínica sem assinatura (sem assinatura = acesso completo).
export async function startTrial(tx: Prisma.TransactionClient, tenantId: string) {
  await tx.tenantSubscription.create({
    data: { tenantId, planId: TRIAL_PLAN_ID, status: 'trialing', trialEndsAt: trialEndsAt() },
  });
}

// Resumo para o /auth/me: todo usuário (não só o admin) precisa saber se a clínica está em teste,
// em atraso ou só leitura, para o front mostrar o aviso e esconder os botões de alteração.
export function subscriptionSummary(
  sub: (SubscriptionTiming & { planId: string; currentPeriodEnd: Date | null }) | null,
  now = new Date(),
) {
  if (!sub) {
    return null;
  }
  return {
    planId: sub.planId,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    ...subscriptionAccess(sub, now),
  };
}
