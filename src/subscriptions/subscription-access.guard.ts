import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { SUBSCRIPTION_EXEMPT_KEY } from './subscription-exempt.decorator.js';
import { subscriptionAccess } from './subscription-access.js';

const READ_METHODS = new Set(['GET', 'HEAD']);

// Depois das permissões: aplica o estado da assinatura da clínica de quem chama. "Só leitura"
// deixa ler (GET); "bloqueada" não deixa nada além das rotas isentas (@SubscriptionExempt).
// Responde 402 com `code`, para o front mostrar a tela de contratação em vez de um erro genérico.
// A assinatura já vem no usuário (JwtStrategy, na mesma consulta): nenhuma ida extra ao banco.
@Injectable()
export class SubscriptionAccessGuard {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(SUBSCRIPTION_EXEMPT_KEY, targets)
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user) {
      return true;
    }
    const { access } = subscriptionAccess(user.subscription ?? null);
    if (access === 'full' || (access === 'read_only' && READ_METHODS.has(request.method))) {
      return true;
    }
    const readOnly = access === 'read_only';
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Payment Required',
        code: readOnly ? 'subscription_read_only' : 'subscription_blocked',
        message: readOnly
          ? 'A clínica está em modo só leitura: contrate um plano para voltar a alterar dados'
          : 'O acesso da clínica está suspenso: contrate um plano para voltar a usar o sistema',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
