import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AppointmentsService } from './appointments.service.js';
import { CreateAppointmentDto } from './dto/create-appointment.dto.js';
import { UpdateAppointmentDto } from './dto/update-appointment.dto.js';
import { FindAppointmentsQueryDto } from './dto/find-appointments-query.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

// appointments:read/write liberam a rota; o escopo (só a própria agenda ou a de todos, com
// appointments:all) é aplicado no serviço, porque depende do agendamento em questão.
@Controller('tenants/:tenantId/appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @RequirePermissions('appointments:write')
  @Post()
  create(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.appointmentsService.create(tenantId, actor, dto);
  }

  @RequirePermissions('appointments:read')
  @Get()
  findAll(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FindAppointmentsQueryDto,
  ) {
    return this.appointmentsService.findAll(tenantId, actor, query);
  }

  @RequirePermissions('appointments:read')
  @Get(':id')
  findOne(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.findOne(tenantId, actor, id);
  }

  @RequirePermissions('appointments:write')
  @Patch(':id')
  update(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.appointmentsService.update(tenantId, actor, id, dto);
  }

  @RequirePermissions('appointments:write')
  @Delete(':id')
  remove(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.remove(tenantId, actor, id);
  }
}
