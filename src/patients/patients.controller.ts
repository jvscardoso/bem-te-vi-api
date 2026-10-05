import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PatientsService } from './patients.service.js';
import { PatientExportService } from './patient-export.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { CreateAnamnesisRecordDto } from './dto/create-anamnesis-record.dto.js';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

// Toda rota recebe o ator: cada acesso a dado de paciente entra na trilha de auditoria.
@Controller('tenants/:tenantId/patients')
export class PatientsController {
  constructor(
    private readonly patientsService: PatientsService,
    private readonly exporter: PatientExportService,
  ) {}

  @RequirePermissions('patients:write')
  @Post()
  create(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreatePatientDto,
  ) {
    return this.patientsService.create(tenantId, actor, dto);
  }

  @RequirePermissions('patients:read')
  @Get()
  findAll(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListPatientsQueryDto,
  ) {
    return this.patientsService.findAll(tenantId, actor, query);
  }

  // Antes de ':id' para não ser tratada como um id. Só quem pode escrever vê/restaura removidos.
  @RequirePermissions('patients:write')
  @Get('removed')
  findRemoved(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListPatientsQueryDto,
  ) {
    return this.patientsService.findRemoved(tenantId, actor, query);
  }

  @RequirePermissions('patients:read')
  @Get(':id')
  findOne(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.patientsService.findOne(tenantId, actor, id);
  }

  @RequirePermissions('patients:write')
  @Patch(':id')
  update(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
  ) {
    return this.patientsService.update(tenantId, actor, id, dto);
  }

  @RequirePermissions('patients:write')
  @Delete(':id')
  remove(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.patientsService.remove(tenantId, actor, id);
  }

  @RequirePermissions('patients:write')
  @Post(':id/restore')
  restore(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.patientsService.restore(tenantId, actor, id);
  }

  @RequirePermissions('patients:write')
  @Post(':id/anamnesis-records')
  addAnamnesisRecord(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateAnamnesisRecordDto,
  ) {
    return this.patientsService.addAnamnesisRecord(tenantId, actor, id, dto);
  }

  @RequirePermissions('patients:read')
  @Get(':id/anamnesis-records')
  listAnamnesisRecords(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.patientsService.listAnamnesisRecords(tenantId, actor, id);
  }

  // Arquivo JSON com tudo o que a clínica guarda sobre o paciente (pedido do titular, LGPD).
  // Baixa como anexo; também funciona com paciente removido.
  @RequirePermissions('patients:export')
  @Header('Cache-Control', 'no-store')
  @Get(':id/export')
  async export(
    @Param('tenantId') tenantId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.exporter.export(tenantId, actor, id);
    res.setHeader('Content-Disposition', `attachment; filename="paciente-${id}.json"`);
    return data;
  }
}
