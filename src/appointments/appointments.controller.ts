import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AppointmentsService } from './appointments.service.js';
import { CreateAppointmentDto } from './dto/create-appointment.dto.js';
import { UpdateAppointmentDto } from './dto/update-appointment.dto.js';
import { FindAppointmentsQueryDto } from './dto/find-appointments-query.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';

@Controller('tenants/:tenantId/appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @RequirePermissions('appointments:write')
  @Post()
  create(@Param('tenantId') tenantId: string, @Body() dto: CreateAppointmentDto) {
    return this.appointmentsService.create(tenantId, dto);
  }

  @RequirePermissions('appointments:read')
  @Get()
  findAll(@Param('tenantId') tenantId: string, @Query() query: FindAppointmentsQueryDto) {
    return this.appointmentsService.findAll(tenantId, query);
  }

  @RequirePermissions('appointments:read')
  @Get(':id')
  findOne(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.appointmentsService.findOne(tenantId, id);
  }

  @RequirePermissions('appointments:write')
  @Patch(':id')
  update(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.appointmentsService.update(tenantId, id, dto);
  }

  @RequirePermissions('appointments:write')
  @Delete(':id')
  remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.appointmentsService.remove(tenantId, id);
  }
}
