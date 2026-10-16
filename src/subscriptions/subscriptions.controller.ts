import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SubscriptionsService, type AsaasWebhookPayload } from './subscriptions.service.js';
import { ContractSubscriptionDto } from './dto/contract-subscription.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { TenantParam } from '../auth/decorators/tenant-param.decorator.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { SubscriptionExempt } from './subscription-exempt.decorator.js';

@Controller('public/plans')
export class PublicPlansController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Public()
  @Get()
  list() {
    return this.subscriptions.plans();
  }
}

// Isenta do modo só leitura/bloqueado: é por aqui que a clínica contrata e volta a ter acesso.
@SubscriptionExempt()
@TenantParam('id')
@Controller('tenants/:id/subscription')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @RequirePermissions('tenant:manage')
  @Get()
  view(@Param('id') id: string) {
    return this.subscriptions.view(id);
  }

  @RequirePermissions('tenant:manage')
  @Post()
  contract(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser, @Body() dto: ContractSubscriptionDto) {
    return this.subscriptions.contract(id, actor, dto);
  }
}

// Chamado pelo Asaas. Sem login: a origem é provada pelo header `asaas-access-token`, o token
// configurado no painel do Asaas (ASAAS_WEBHOOK_TOKEN). Sem rate limit: o Asaas reenvia em rajada
// depois de uma indisponibilidade, e recusar com 429 só atrasaria a liberação das clínicas.
@Controller('webhooks/asaas')
export class AsaasWebhookController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @Post()
  receive(@Headers('asaas-access-token') token: string | undefined, @Body() payload: AsaasWebhookPayload) {
    return this.subscriptions.handleWebhook(token, payload);
  }
}
