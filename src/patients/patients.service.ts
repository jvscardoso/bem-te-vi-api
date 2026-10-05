import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Patient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { CreateAnamnesisRecordDto } from './dto/create-anamnesis-record.dto.js';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto.js';
import { pageOf, type Page } from '../common/pagination/page.js';
import {
  validateAnswers,
  type AnamnesisFieldDefinition,
} from '../anamnesis-templates/anamnesis-answers.validator.js';

// Palavra da busca que só tem dígitos e pontuação de CPF ("123", "123.456", "123.456.789-01").
const CPF_TOKEN = /^[\d.-]+$/;

// Toda leitura e escrita de paciente e de registro clínico grava na trilha de auditoria
// (AuditService): é o que permite à clínica responder "quem acessou os dados deste paciente?".
@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, actor: AuthenticatedUser, dto: CreatePatientDto) {
    await this.assertCpfAvailable(tenantId, dto.cpf);
    return this.prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({ data: { ...this.toData(dto), tenantId } });
      await this.audit.record(actor, { action: 'patient.create', patientId: patient.id }, tx);
      return patient;
    });
  }

  // A listagem expõe nome e CPF de vários pacientes: registra a busca feita (termo e página),
  // não cada paciente da página.
  async findAll(tenantId: string, actor: AuthenticatedUser, query: ListPatientsQueryDto) {
    const page = await this.paginate(tenantId, query, false);
    await this.audit.record(actor, { action: 'patient.list', details: this.listDetails(query, page.meta.total) });
    return page;
  }

  async findRemoved(tenantId: string, actor: AuthenticatedUser, query: ListPatientsQueryDto) {
    const page = await this.paginate(tenantId, query, true);
    await this.audit.record(actor, { action: 'patient.list_removed', details: this.listDetails(query, page.meta.total) });
    return page;
  }

  async findOne(tenantId: string, actor: AuthenticatedUser, id: string) {
    const patient = await this.getActive(tenantId, id);
    await this.audit.record(actor, { action: 'patient.view', patientId: id });
    return patient;
  }

  // Registra o que mudou (de → para), campo a campo: a trilha guarda o histórico do cadastro,
  // que o próprio registro (só o valor atual) não tem.
  async update(tenantId: string, actor: AuthenticatedUser, id: string, dto: UpdatePatientDto) {
    const before = await this.getActive(tenantId, id);
    await this.assertCpfAvailable(tenantId, dto.cpf, id);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.patient.update({ where: { id }, data: this.toData(dto) });
      const changes = this.diff(before, after, Object.keys(dto) as (keyof Patient)[]);
      await this.audit.record(actor, { action: 'patient.update', patientId: id, details: { changes } }, tx);
      return after;
    });
  }

  // `null` limpa o campo (contrato de todo PATCH). Precisa de tradução em dois casos:
  // data vira Date, e Json nulo no Prisma exige Prisma.DbNull (um `null` cru é recusado).
  private toData<T extends UpdatePatientDto>(dto: T) {
    const { birthDate, address, ...rest } = dto;
    return {
      ...rest,
      birthDate: birthDate === null ? null : birthDate ? new Date(birthDate) : undefined,
      address: address === null ? Prisma.DbNull : (address as Prisma.InputJsonValue | undefined),
    };
  }

  async remove(tenantId: string, actor: AuthenticatedUser, id: string) {
    await this.getActive(tenantId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.patient.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(actor, { action: 'patient.delete', patientId: id }, tx);
    });
  }

  // Desfaz o soft delete. O CPF nunca foi liberado, então não há conflito possível ao voltar.
  async restore(tenantId: string, actor: AuthenticatedUser, id: string) {
    const removed = await this.prisma.patient.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
      select: { id: true },
    });
    if (!removed) {
      throw new NotFoundException(`Paciente removido ${id} não encontrado`);
    }
    return this.prisma.$transaction(async (tx) => {
      const patient = await tx.patient.update({ where: { id }, data: { deletedAt: null } });
      await this.audit.record(actor, { action: 'patient.restore', patientId: id }, tx);
      return patient;
    });
  }

  // Leitura interna (sem auditoria): checagem de existência antes de alterar, que já é
  // auditada pela própria alteração.
  private async getActive(tenantId: string, id: string) {
    const patient = await this.prisma.patient.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!patient) {
      throw new NotFoundException(`Paciente ${id} não encontrado`);
    }
    return patient;
  }

  private listDetails(query: ListPatientsQueryDto, total: number) {
    return { q: query.q ?? null, page: query.page, pageSize: query.pageSize, total };
  }

  // Só os campos enviados que de fato mudaram. Datas e JSON comparados pelo valor serializado.
  private diff(before: Patient, after: Patient, fields: (keyof Patient)[]) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of fields) {
      const from = before[field] ?? null;
      const to = after[field] ?? null;
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        changes[field] = { from, to } as { from: unknown; to: unknown };
      }
    }
    return JSON.parse(JSON.stringify(changes)) as Prisma.InputJsonObject;
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

    return pageOf(
      ids.flatMap((id) => byId.get(id) ?? []),
      total,
      page,
      pageSize,
    );
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

  // O conteúdo clínico não vai para a trilha (ficaria duplicado num lugar com outro controle de
  // acesso): o registro aponta para a ficha criada, que é imutável.
  async addAnamnesisRecord(
    tenantId: string,
    actor: AuthenticatedUser,
    patientId: string,
    dto: CreateAnamnesisRecordDto,
  ) {
    await this.getActive(tenantId, patientId);
    // O FK do banco só garante que o template existe, não que é deste tenant nem que
    // `answers` bate com os campos dele — as duas coisas checadas aqui, não no banco.
    const template = await this.prisma.anamnesisTemplate.findFirst({
      where: { id: dto.templateId, tenantId },
      select: { fields: true },
    });
    if (!template) {
      throw new BadRequestException('templateId inválido para este tenant');
    }
    const errors = validateAnswers(template.fields as unknown as AnamnesisFieldDefinition[], dto.answers);
    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    return this.prisma.$transaction(async (tx) => {
      const record = await tx.anamnesisRecord.create({
        data: {
          tenantId,
          patientId,
          templateId: dto.templateId,
          filledByUserId: actor.userId,
          answers: dto.answers as Prisma.InputJsonValue,
        },
        include: { template: { select: { id: true, name: true } } },
      });
      await this.audit.record(
        actor,
        { action: 'clinical_record.create', patientId, entityType: 'anamnesis_record', entityId: record.id },
        tx,
      );
      return record;
    });
  }

  async listAnamnesisRecords(tenantId: string, actor: AuthenticatedUser, patientId: string) {
    await this.getActive(tenantId, patientId);
    const records = await this.prisma.anamnesisRecord.findMany({
      where: { tenantId, patientId },
      orderBy: { createdAt: 'desc' },
      include: { template: { select: { id: true, name: true } } },
    });
    await this.audit.record(actor, {
      action: 'clinical_record.list',
      patientId,
      details: { count: records.length },
    });
    return records;
  }
}
