import { Injectable } from '@nestjs/common';
import type { ConsentPurpose, ConsentSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { Db } from '../access/access-policy.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import type { UpdatePatientConsentsDto } from './dto/update-patient-consents.dto.js';

const PURPOSES: ConsentPurpose[] = ['whatsapp', 'marketing'];

export interface ConsentState {
  granted: boolean;
  // Quando e por quem foi a última mudança; null = nunca registrado (vale como "não").
  updatedAt: Date | null;
  source: ConsentSource | null;
}

export type ConsentsView = Record<ConsentPurpose, ConsentState>;

// Consentimento do paciente para comunicação (ver PatientConsent no schema). Cada mudança é uma
// linha nova: o histórico é a prova, para a LGPD, de quando o paciente aceitou ou recusou.
@Injectable()
export class PatientConsentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async current(patientId: string, db: Db = this.prisma): Promise<ConsentsView> {
    const latest = await Promise.all(
      PURPOSES.map((purpose) =>
        db.patientConsent.findFirst({
          where: { patientId, purpose },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { granted: true, createdAt: true, source: true },
        }),
      ),
    );
    return Object.fromEntries(
      PURPOSES.map((purpose, i) => {
        const row = latest[i];
        return [purpose, { granted: row?.granted ?? false, updatedAt: row?.createdAt ?? null, source: row?.source ?? null }];
      }),
    ) as ConsentsView;
  }

  // Registro pela equipe da clínica. Só grava o que de fato muda (repetir "sim" não cria uma linha
  // nova), e a auditoria entra na mesma transação, com o de → para.
  async updateByStaff(actor: AuthenticatedUser, patientId: string, dto: UpdatePatientConsentsDto) {
    return this.prisma.$transaction(async (tx) => {
      // Duas edições ao mesmo tempo leriam o mesmo "antes" e gravariam a mudança duas vezes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`consent:${patientId}`}))`;
      const before = await this.current(patientId, tx);
      const changes: Record<string, { from: boolean; to: boolean }> = {};
      for (const purpose of PURPOSES) {
        const wanted = dto[purpose];
        if (wanted === undefined || wanted === before[purpose].granted) {
          continue;
        }
        await tx.patientConsent.create({
          data: {
            tenantId: actor.tenantId,
            patientId,
            purpose,
            granted: wanted,
            source: 'staff',
            recordedByUserId: actor.userId,
          },
        });
        changes[purpose] = { from: before[purpose].granted, to: wanted };
      }
      if (Object.keys(changes).length > 0) {
        await this.audit.record(actor, { action: 'patient.consent_update', patientId, details: { changes } }, tx);
      }
      return this.current(patientId, tx);
    });
  }

  // Histórico completo, para as exportações (LGPD).
  history(patientId: string) {
    return this.prisma.patientConsent.findMany({
      where: { patientId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { purpose: true, granted: true, source: true, recordedByUserId: true, createdAt: true },
    });
  }
}
