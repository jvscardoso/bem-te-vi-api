import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AnamnesisTemplatesService } from './anamnesis-templates.service.js';
import { CreateAnamnesisTemplateDto } from './dto/create-anamnesis-template.dto.js';
import { UpdateAnamnesisTemplateDto } from './dto/update-anamnesis-template.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';

@Controller('tenants/:tenantId/anamnesis-templates')
export class AnamnesisTemplatesController {
  constructor(private readonly templatesService: AnamnesisTemplatesService) {}

  @RequirePermissions('anamnesis_templates:manage')
  @Post()
  create(@Param('tenantId') tenantId: string, @Body() dto: CreateAnamnesisTemplateDto) {
    return this.templatesService.create(tenantId, dto);
  }

  // Leitura é liberada para quem preenche ou lê anamnese (não exige poder editar o formulário).
  @RequirePermissions('patients:read')
  @Get()
  findAll(@Param('tenantId') tenantId: string) {
    return this.templatesService.findAll(tenantId);
  }

  @RequirePermissions('patients:read')
  @Get(':id')
  findOne(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.templatesService.findOne(tenantId, id);
  }

  @RequirePermissions('anamnesis_templates:manage')
  @Patch(':id')
  update(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAnamnesisTemplateDto,
  ) {
    return this.templatesService.update(tenantId, id, dto);
  }

  @RequirePermissions('anamnesis_templates:manage')
  @Delete(':id')
  remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.templatesService.remove(tenantId, id);
  }
}
