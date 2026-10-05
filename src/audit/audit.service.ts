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
  'clinical_record.list',
  'clinical_record.create',
  // Exportação de dados (direito de acesso/portabilidade do titular; saída da clínica).
  'patient.export',
  'tenant.export',
  'tenant.closure_requested',
  'tenant.closure_cancelled',
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
  async record(actor: AuthenticatedUser, entry: AuditEntry, db: Db = this.prisma) {
    const { ip, userAgent } = RequestContext.current();
    await db.auditLog.create({
      data: { tenantId: actor.tenantId, actorUserId: actor.userId, ...entry, ip, userAgent },
    });
  }

  // Mais recente primeiro, com desempate por id. O nome de quem agiu vem por consulta à parte
  // (sem FK de propósito: o registro sobrevive ao usuário).
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
    const actors = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(actors.map((user) => [user.id, user.name]));

    return pageOf(
      rows.map(({ tenantId: _tenantId, ...row }) => ({
        ...row,
        actor: { id: row.actorUserId, name: nameById.get(row.actorUserId) ?? null },
      })),
      total,
      page,
      pageSize,
    );
  }
}
