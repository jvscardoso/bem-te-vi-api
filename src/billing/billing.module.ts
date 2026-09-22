import { Module } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { ChargesController } from './charges.controller.js';
import { BillingSummaryController } from './billing-summary.controller.js';

@Module({
  controllers: [ChargesController, BillingSummaryController],
  providers: [BillingService],
})
export class BillingModule {}
