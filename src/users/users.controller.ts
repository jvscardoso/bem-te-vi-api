import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdateAppointmentSettingsDto } from './dto/update-appointment-settings.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

@RequirePermissions('users:manage')
@Controller('tenants/:tenantId/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Param('tenantId') tenantId: string, @Body() dto: CreateUserDto) {
    return this.usersService.create(tenantId, dto);
  }

  @Get()
  findAll(@Param('tenantId') tenantId: string) {
    return this.usersService.findAll(tenantId);
  }

  // O próprio profissional ajusta a duração dos seus atendimentos sem precisar de
  // 'users:manage' (a permissão do handler substitui a do controller).
  @RequirePermissions('appointments:write')
  @Patch('me/appointment-settings')
  updateOwnAppointmentSettings(
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAppointmentSettingsDto,
  ) {
    return this.usersService.updateOwnAppointmentSettings(tenantId, user.userId, dto);
  }

  @Get(':id')
  findOne(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.usersService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(tenantId, id, dto);
  }
}
