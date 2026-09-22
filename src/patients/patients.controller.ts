import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PatientsService } from './patients.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { CreateAnamnesisRecordDto } from './dto/create-anamnesis-record.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

@Controller('tenants/:tenantId/patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @RequirePermissions('patients:write')
  @Post()
  create(@Param('tenantId') tenantId: string, @Body() dto: CreatePatientDto) {
    return this.patientsService.create(tenantId, dto);
  }

  @RequirePermissions('patients:read')
  @Get()
  findAll(@Param('tenantId') tenantId: string) {
    return this.patientsService.findAll(tenantId);
  }

  // Antes de ':id' para não ser tratada como um id. Só quem pode escrever vê/restaura removidos.
  @RequirePermissions('patients:write')
  @Get('removed')
  findRemoved(@Param('tenantId') tenantId: string) {
    return this.patientsService.findRemoved(tenantId);
  }

  @RequirePermissions('patients:read')
  @Get(':id')
  findOne(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.patientsService.findOne(tenantId, id);
  }

  @RequirePermissions('patients:write')
  @Patch(':id')
  update(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
  ) {
    return this.patientsService.update(tenantId, id, dto);
  }

  @RequirePermissions('patients:write')
  @Delete(':id')
  remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.patientsService.remove(tenantId, id);
  }

  @RequirePermissions('patients:write')
  @Post(':id/restore')
  restore(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.patientsService.restore(tenantId, id);
  }

  @RequirePermissions('patients:write')
  @Post(':id/anamnesis-records')
  addAnamnesisRecord(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateAnamnesisRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.patientsService.addAnamnesisRecord(tenantId, id, user.userId, dto);
  }

  @RequirePermissions('patients:read')
  @Get(':id/anamnesis-records')
  listAnamnesisRecords(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.patientsService.listAnamnesisRecords(tenantId, id);
  }
}
