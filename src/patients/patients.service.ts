import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { CreateAnamnesisRecordDto } from './dto/create-anamnesis-record.dto.js';

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, dto: CreatePatientDto) {
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
