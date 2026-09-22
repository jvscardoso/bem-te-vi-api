import { Controller, Get, Param, Query } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { BillingSummaryQueryDto } from './dto/billing-summary-query.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';

@Controller('tenants/:tenantId/billing')
export class BillingSummaryController {
  constructor(private readonly billingService: BillingService) {}

  @RequirePermissions('billing:read')
  @Get('summary')
  summary(@Param('tenantId') tenantId: string, @Query() query: BillingSummaryQueryDto) {
    return this.billingService.summary(tenantId, query);
  }
}
