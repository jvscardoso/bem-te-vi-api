import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { TENANT_PARAM_KEY } from '../decorators/tenant-param.decorator.js';
import type { AuthenticatedUser } from '../types/auth.types.js';

// Garante que um usuário autenticado só acesse recursos do próprio tenant,
// mesmo que ele monte manualmente uma URL com o tenantId de outra clínica.
@Injectable()
export class TenantAccessGuard {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const paramKey =
      this.reflector.getAllAndOverride<string>(TENANT_PARAM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'tenantId';

    const request = context.switchToHttp().getRequest();
    const routeTenantId = request.params?.[paramKey];
    if (!routeTenantId) {
      return true;
    }

    const user: AuthenticatedUser | undefined = request.user;
    if (!user || user.tenantId !== routeTenantId) {
      throw new ForbiddenException('Sem acesso a recursos de outro tenant');
    }

    return true;
  }
}
