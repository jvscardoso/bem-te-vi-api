import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { AsaasWebhookController, PublicPlansController, SubscriptionsController } from './subscriptions.controller.js';
import { AsaasPaymentGateway, PaymentGateway } from './payment-gateway.js';

@Module({
  imports: [AuditModule],
  controllers: [PublicPlansController, SubscriptionsController, AsaasWebhookController],
  providers: [SubscriptionsService, { provide: PaymentGateway, useClass: AsaasPaymentGateway }],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
