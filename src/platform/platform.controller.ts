import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { PlatformService } from './platform.service.js';
import { ListPlatformTenantsQueryDto } from './dto/list-platform-tenants-query.dto.js';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';

// Backoffice da plataforma: gerencia as clínicas como contas (listar, suspender/reativar).
// De propósito fora da árvore /tenants/:tenantId/...: sem `:tenantId` na URL, o
// TenantAccessGuard global não tem o que checar aqui — o controle de acesso é só a
// permissão `platform:manage`, que nenhum tenant de cliente pode ter (ver TenantsService.create).
@RequirePermissions('platform:manage')
@Controller('platform/tenants')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  findAll(@Query() query: ListPlatformTenantsQueryDto) {
    return this.platformService.findAllTenants(query);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTenantStatusDto) {
    return this.platformService.updateTenantStatus(id, dto);
  }
}
