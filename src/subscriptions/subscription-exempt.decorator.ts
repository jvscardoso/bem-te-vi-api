import { SetMetadata } from '@nestjs/common';

export const SUBSCRIPTION_EXEMPT_KEY = 'subscriptionExempt';

// Rota que funciona mesmo com a assinatura em "só leitura" ou bloqueada: sessão (login, /auth/me,
// logout), a própria assinatura (para contratar) e a saída da clínica (exportar e encerrar: a
// clínica nunca fica sem conseguir levar os próprios dados, LGPD).
export const SubscriptionExempt = () => SetMetadata(SUBSCRIPTION_EXEMPT_KEY, true);
