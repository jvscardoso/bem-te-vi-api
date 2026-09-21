import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TenantsService } from './tenants.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { UpdateTenantBrandingDto } from './dto/update-tenant-branding.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { TenantParam } from '../auth/decorators/tenant-param.decorator.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';

// O :id aqui É o tenantId (o tenant é o próprio recurso), por isso @TenantParam('id')
// no lugar do default 'tenantId' que os outros controllers (aninhados) usam.
@TenantParam('id')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  // Signup público: cria o tenant + role "Admin" (todas as permissões) + usuário dono,
  // já que não existe ninguém autenticado ainda para fazer essas chamadas em sequência.
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @RequirePermissions('tenant:manage')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @RequirePermissions('tenant:manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @RequirePermissions('tenant:manage')
  @Patch(':id/branding')
  updateBranding(@Param('id') id: string, @Body() dto: UpdateTenantBrandingDto) {
    return this.tenantsService.updateBranding(id, dto);
  }
}
