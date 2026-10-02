import { Controller, Get, Param } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

// Fora de UsersController de propósito: lá tudo exige users:manage, e quem agenda (ex.:
// recepção) precisa escolher o profissional sem poder gerenciar usuários.
@Controller('tenants/:tenantId/professionals')
export class ProfessionalsController {
  constructor(private readonly usersService: UsersService) {}

  @RequirePermissions('appointments:read')
  @Get()
  findAll(@Param('tenantId') tenantId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.findProfessionals(tenantId, actor);
  }
}
