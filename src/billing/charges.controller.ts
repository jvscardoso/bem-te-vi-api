import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { CreateChargeDto } from './dto/create-charge.dto.js';
import { UpdateChargeDto } from './dto/update-charge.dto.js';
import { ListChargesQueryDto } from './dto/list-charges-query.dto.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

@Controller('tenants/:tenantId/charges')
export class ChargesController {
  constructor(private readonly billingService: BillingService) {}

  @RequirePermissions('billing:write')
  @Post()
  create(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateChargeDto,
  ) {
    return this.billingService.createCharge(tenantId, actor.userId, dto);
  }

  @RequirePermissions('billing:read')
  @Get()
  findAll(@Param('tenantId') tenantId: string, @Query() query: ListChargesQueryDto) {
    return this.billingService.findAllCharges(tenantId, query);
  }

  @RequirePermissions('billing:read')
  @Get(':id')
  findOne(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.billingService.findOneCharge(tenantId, id);
  }

  @RequirePermissions('billing:write')
  @Patch(':id')
  update(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateChargeDto,
  ) {
    return this.billingService.updateCharge(tenantId, id, dto);
  }

  @RequirePermissions('billing:write')
  @Delete(':id')
  remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.billingService.cancelCharge(tenantId, id);
  }

  @RequirePermissions('billing:write')
  @Post(':id/payments')
  addPayment(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.billingService.recordPayment(tenantId, id, actor.userId, dto);
  }

  @RequirePermissions('billing:read')
  @Get(':id/payments')
  listPayments(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.billingService.listPayments(tenantId, id);
  }
}
