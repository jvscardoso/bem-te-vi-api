import { Controller, Get, Param, Query } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';

// Só leitura: não existe rota que altere ou apague a trilha (e o banco recusa UPDATE).
@RequirePermissions('audit:read')
@Controller('tenants/:tenantId/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  findAll(@Param('tenantId') tenantId: string, @Query() query: ListAuditLogsQueryDto) {
    return this.auditService.list(tenantId, query);
  }
}
