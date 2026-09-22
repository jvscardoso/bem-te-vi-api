import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Patient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { CreateAnamnesisRecordDto } from './dto/create-anamnesis-record.dto.js';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto.js';

export interface Page<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

// Palavra da busca que só tem dígitos e pontuação de CPF ("123", "123.456", "123.456.789-01").
const CPF_TOKEN = /^[\d.-]+$/;

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

  findAll(tenantId: string, query: ListPatientsQueryDto) {
    return this.paginate(tenantId, query, false);
  }

  findRemoved(tenantId: string, query: ListPatientsQueryDto) {
    return this.paginate(tenantId, query, true);
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

  // Ordem estável (desempate por id) para a paginação não repetir nem pular registros.
  // SQL cru só para achar os ids da página: o Prisma não expressa unaccent/ILIKE por palavra.
  // Os registros vêm depois pelo Prisma, então a forma da resposta é a de sempre.
  private async paginate(
    tenantId: string,
    { q, page, pageSize }: ListPatientsQueryDto,
    removed: boolean,
  ): Promise<Page<Patient>> {
    const where = this.searchCondition(tenantId, q, removed);
    const order = removed
      ? Prisma.sql`deleted_at DESC, id ASC`
      : Prisma.sql`full_name ASC, id ASC`;

    const [idRows, countRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM patients WHERE ${where}
        ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM patients WHERE ${where}`,
    ]);

    const ids = idRows.map((row) => row.id);
    const rows = ids.length
      ? await this.prisma.patient.findMany({ where: { id: { in: ids }, tenantId } })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const total = Number(countRows[0]?.total ?? 0);

    return {
      data: ids.flatMap((id) => byId.get(id) ?? []),
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  }

  // Cada palavra da busca precisa casar (AND). Tudo parametrizado; os curingas do LIKE
  // digitados pelo usuário são escapados para valerem como texto literal.
  private searchCondition(tenantId: string, q: string | undefined, removed: boolean) {
    const conditions = [
      Prisma.sql`tenant_id = ${tenantId}`,
      removed ? Prisma.sql`deleted_at IS NOT NULL` : Prisma.sql`deleted_at IS NULL`,
    ];

    for (const token of (q ?? '').split(/\s+/).filter(Boolean)) {
      if (CPF_TOKEN.test(token)) {
        // CPF é guardado só com dígitos, então "123.456" e "123456" são a mesma busca.
        const digits = token.replace(/\D/g, '');
        if (digits) {
          conditions.push(Prisma.sql`cpf LIKE ${`%${digits}%`}`);
        }
      } else {
        // \ é o escape padrão do LIKE no Postgres: "\%" e "\_" viram % e _ literais.
        const pattern = `%${token.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
        conditions.push(Prisma.sql`unaccent(full_name) ILIKE unaccent(${pattern})`);
      }
    }
    return Prisma.join(conditions, ' AND ');
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
