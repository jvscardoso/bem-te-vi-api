import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { CreateAnamnesisRecordDto } from './dto/create-anamnesis-record.dto.js';

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreatePatientDto) {
    await this.assertCpfAvailable(tenantId, dto.cpf);
    return this.prisma.patient.create({
      data: {
        ...dto,
        tenantId,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        address: dto.address as Prisma.InputJsonValue,
      },
    });
  }

  findAll(tenantId: string) {
    return this.prisma.patient.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { fullName: 'asc' },
    });
  }

  findRemoved(tenantId: string) {
    return this.prisma.patient.findMany({
      where: { tenantId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!patient) {
      throw new NotFoundException(`Paciente ${id} não encontrado`);
    }
    return patient;
  }

  async update(tenantId: string, id: string, dto: UpdatePatientDto) {
    await this.findOne(tenantId, id);
    await this.assertCpfAvailable(tenantId, dto.cpf, id);
    return this.prisma.patient.update({
      where: { id },
      data: {
        ...dto,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        address: dto.address as Prisma.InputJsonValue,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.patient.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // Desfaz o soft delete. O CPF nunca foi liberado, então não há conflito possível ao voltar.
  async restore(tenantId: string, id: string) {
    const removed = await this.prisma.patient.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
      select: { id: true },
    });
    if (!removed) {
      throw new NotFoundException(`Paciente removido ${id} não encontrado`);
    }
    return this.prisma.patient.update({ where: { id }, data: { deletedAt: null } });
  }

  // O CPF de um paciente removido continua reservado (para não duplicar o cadastro/prontuário).
  // Quando é esse o caso, o 409 informa o id para o cliente oferecer "restaurar".
  private async assertCpfAvailable(tenantId: string, cpf?: string, excludeId?: string) {
    if (!cpf) {
      return;
    }
    const existing = await this.prisma.patient.findFirst({
      where: { tenantId, cpf, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, deletedAt: true },
    });
    if (!existing) {
      return;
    }
    if (existing.deletedAt) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'Existe um paciente removido com este CPF; restaure-o em vez de recadastrar',
        removedPatientId: existing.id,
      });
    }
    throw new ConflictException('Já existe um paciente com este CPF');
  }

  async addAnamnesisRecord(
    tenantId: string,
    patientId: string,
    filledByUserId: string,
    dto: CreateAnamnesisRecordDto,
  ) {
    await this.findOne(tenantId, patientId);
    return this.prisma.anamnesisRecord.create({
      data: {
        tenantId,
        patientId,
        filledByUserId,
        answers: dto.answers as Prisma.InputJsonValue,
      },
    });
  }

  async listAnamnesisRecords(tenantId: string, patientId: string) {
    await this.findOne(tenantId, patientId);
    return this.prisma.anamnesisRecord.findMany({
      where: { tenantId, patientId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
