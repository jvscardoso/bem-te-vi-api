import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestContext } from '../common/request-context/request-context.js';
import { pageOf } from '../common/pagination/page.js';
import type { Db } from '../access/access-policy.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import type { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';

// O que é auditado: acesso e alteração de dado de paciente (cadastro e registro clínico).
// Agenda e financeiro ficam de fora por ora — volume alto e dado menos sensível.
export const AUDIT_ACTIONS = [
  'patient.list',
  'patient.list_removed',
  'patient.view',
  'patient.create',
  'patient.update',
  'patient.delete',
  'patient.restore',
  // Mudança de consentimento (WhatsApp, marketing): details.changes com de → para.
  'patient.consent_update',
  'clinical_record.list',
  'clinical_record.create',
  // Exportação de dados (direito de acesso/portabilidade do titular; saída da clínica).
  'patient.export',
  'tenant.export',
  'tenant.closure_requested',
  'tenant.closure_cancelled',
  // Conta bloqueada por senhas erradas seguidas (ver LoginAttemptsService). O "ator" é a conta
  // atacada: quem errou a senha não se identificou.
  'auth.login_locked',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  patientId?: string;
  entityType?: string;
  entityId?: string;
  details?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Grava de forma síncrona: se a auditoria falhar, a requisição falha junto. Acesso a dado de
  // saúde sem registro não deve acontecer "em silêncio". Para escritas, passe a transação (`db`)
  // da própria alteração: alteração e registro entram ou falham juntos.
  async record(actor: Pick<AuthenticatedUser, 'userId' | 'tenantId'>, entry: AuditEntry, db: Db = this.prisma) {
    const { ip, userAgent } = RequestContext.current();
    await db.auditLog.create({
      data: { tenantId: actor.tenantId, actorUserId: actor.userId, ...entry, ip, userAgent },
    });
  }

  // Mais recente primeiro, com desempate por id. Os nomes de quem agiu e do paciente vêm por
  // consulta à parte (sem FK de propósito: o registro sobrevive ao usuário e ao paciente), uma
  // por página, não uma por linha.
  async list(tenantId: string, query: ListAuditLogsQueryDto) {
    const { page, pageSize, patientId, actorUserId, action, from, to } = query;
    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      patientId,
      actorUserId,
      action,
      createdAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined },
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const actorIds = [...new Set(rows.map((row) => row.actorUserId))];
    const patientIds = [...new Set(rows.flatMap((row) => (row.patientId ? [row.patientId] : [])))];
    // Pacientes lidos direto do banco, sem passar pelo PatientsService: ler a trilha não pode
    // gerar um patient.view por linha (quem audita apareceria abrindo dezenas de fichas). Quem tem
    // audit:read vê só o nome, nenhum dado clínico. Filtrado pela clínica, como tudo.
    const [actors, patients] = await Promise.all([
      actorIds.length
        ? this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
        : [],
      patientIds.length
        ? this.prisma.patient.findMany({
            where: { tenantId, id: { in: patientIds } },
            select: { id: true, fullName: true, deletedAt: true },
          })
        : [],
    ]);
    const nameById = new Map(actors.map((user) => [user.id, user.name]));
    const patientById = new Map(patients.map((patient) => [patient.id, patient]));

    return pageOf(
      rows.map(({ tenantId: _tenantId, ...row }) => ({
        ...row,
        actor: { id: row.actorUserId, name: nameById.get(row.actorUserId) ?? null },
        // null quando o registro não é de um paciente. removed (soft delete, ou o paciente não existe
        // mais, e aí fullName vem null) para o front avisar que a ficha não abre.
        patient: row.patientId ? this.patientView(row.patientId, patientById.get(row.patientId)) : null,
      })),
      total,
      page,
      pageSize,
    );
  }

  private patientView(id: string, patient?: { fullName: string; deletedAt: Date | null }) {
    return { id, fullName: patient?.fullName ?? null, removed: !patient || patient.deletedAt !== null };
  }
}
