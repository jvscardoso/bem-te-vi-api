import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ConfigsService } from './configs.service.js';
import { SaveLayoutDto } from './dto/save-layout.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

@Controller('tenants/:tenantId/configs')
export class ConfigsController {
  constructor(private readonly configs: ConfigsService) {}

  // Sem permissão específica: todo usuário da clínica precisa ler para montar a própria tela
  // (o TenantAccessGuard continua barrando outras clínicas). Por isso nada sensível entra aqui.
  @Get()
  findAll(@Param('tenantId') tenantId: string) {
    return this.configs.findAll(tenantId);
  }

  // O layout é um só para a clínica inteira: quem administra a clínica decide.
  @RequirePermissions('tenant:manage')
  @Put('layouts/:screen')
  saveLayout(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('screen') screen: string,
    @Body() dto: SaveLayoutDto,
  ) {
    return this.configs.saveLayout(tenantId, actor, screen, dto);
  }

  @RequirePermissions('tenant:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('layouts/:screen')
  resetLayout(@Param('tenantId') tenantId: string, @Param('screen') screen: string) {
    return this.configs.resetLayout(tenantId, screen);
  }
}
