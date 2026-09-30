import { Controller, Get } from '@nestjs/common';
import { RolesService } from './roles.service.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

// Catálogo global (não é por tenant), por isso fora de /tenants/:tenantId. Serve ao editor de
// papéis, que precisa dos ids para montar `permissionIds`.
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly rolesService: RolesService) {}

  @RequirePermissions('roles:manage')
  @Get()
  findAll(@CurrentUser() actor: AuthenticatedUser) {
    return this.rolesService.listPermissions(actor);
  }
}
