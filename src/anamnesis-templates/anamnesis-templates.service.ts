import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { validateTemplateFields, type AnamnesisFieldDefinition } from './anamnesis-answers.validator.js';
import { CreateAnamnesisTemplateDto } from './dto/create-anamnesis-template.dto.js';
import { UpdateAnamnesisTemplateDto } from './dto/update-anamnesis-template.dto.js';

@Injectable()
export class AnamnesisTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, dto: CreateAnamnesisTemplateDto) {
    this.assertValidFields(dto.fields);
    return this.prisma.anamnesisTemplate.create({
      data: { tenantId, name: dto.name, fields: dto.fields as unknown as Prisma.InputJsonValue },
    });
  }

  findAll(tenantId: string) {
    return this.prisma.anamnesisTemplate.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async findOne(tenantId: string, id: string) {
    const template = await this.prisma.anamnesisTemplate.findFirst({ where: { id, tenantId } });
    if (!template) {
      throw new NotFoundException(`Formulário de anamnese ${id} não encontrado`);
    }
    return template;
  }

  async update(tenantId: string, id: string, dto: UpdateAnamnesisTemplateDto) {
    await this.findOne(tenantId, id);
    if (dto.fields) {
      this.assertValidFields(dto.fields);
    }
    return this.prisma.anamnesisTemplate.update({
      where: { id },
      data: { ...dto, fields: dto.fields as unknown as Prisma.InputJsonValue },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    // FK Restrict: se algum paciente já tem anamnese com este formulário, o Prisma dá P2003
    // e o PrismaExceptionFilter devolve 409 — apagar aqui perderia o contexto de fichas antigas.
    await this.prisma.anamnesisTemplate.delete({ where: { id } });
  }

  private assertValidFields(fields: AnamnesisFieldDefinition[]) {
    const errors = validateTemplateFields(fields);
    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }
  }
}
