import { annualPriceCents, subscriptionAccess } from './subscription-access.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-01T12:00:00Z');
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY);

describe('subscriptionAccess', () => {
  it('sem assinatura (clínica-plataforma) ou ativa: acesso completo', () => {
    expect(subscriptionAccess(null, now)).toEqual({ access: 'full', reason: null, changesAt: null });
    expect(
      subscriptionAccess({ status: 'active', trialEndsAt: daysFromNow(-60), pastDueSince: null }, now),
    ).toEqual({ access: 'full', reason: null, changesAt: null });
  });

  it('em teste: completo até o fim do teste, só leitura por 30 dias, depois bloqueado', () => {
    const sub = (trialEndsInDays: number) => ({ status: 'trialing' as const, trialEndsAt: daysFromNow(trialEndsInDays), pastDueSince: null });
    expect(subscriptionAccess(sub(3), now)).toEqual({ access: 'full', reason: null, changesAt: daysFromNow(3) });
    expect(subscriptionAccess(sub(-1), now)).toEqual({ access: 'read_only', reason: 'trial_ended', changesAt: daysFromNow(29) });
    expect(subscriptionAccess(sub(-31), now)).toEqual({ access: 'blocked', reason: 'trial_ended', changesAt: null });
  });

  it('em atraso: 7 dias de carência com acesso completo, depois só leitura, depois bloqueado', () => {
    const sub = (pastDueDaysAgo: number) => ({
      status: 'past_due' as const,
      trialEndsAt: daysFromNow(-90),
      pastDueSince: daysFromNow(-pastDueDaysAgo),
    });
    expect(subscriptionAccess(sub(2), now)).toEqual({ access: 'full', reason: 'past_due', changesAt: daysFromNow(5) });
    expect(subscriptionAccess(sub(8), now)).toEqual({ access: 'read_only', reason: 'past_due', changesAt: daysFromNow(29) });
    expect(subscriptionAccess(sub(38), now)).toEqual({ access: 'blocked', reason: 'past_due', changesAt: null });
  });
});

describe('annualPriceCents', () => {
  it('12 meses com 10% de desconto', () => {
    expect(annualPriceCents(9900)).toBe(106920);
    expect(annualPriceCents(14900)).toBe(160920);
    expect(annualPriceCents(29900)).toBe(322920);
    expect(annualPriceCents(54900)).toBe(592920);
  });
});
