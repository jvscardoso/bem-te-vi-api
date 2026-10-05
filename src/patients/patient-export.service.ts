import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import type { AnamnesisFieldDefinition } from '../anamnesis-templates/anamnesis-answers.validator.js';

// Identifica o formato do arquivo para quem o recebe (outro sistema, o próprio paciente).
// Mudou a forma? Suba a versão.
const EXPORT_FORMAT = { format: 'bem-te-vi.patient-export', version: 1 } as const;

// Tudo o que a clínica guarda sobre um paciente, num arquivo só e legível sem o sistema: é como
// ela atende o direito de acesso e de portabilidade do titular (LGPD). As fichas saem com o
// rótulo de cada campo (não só a chave técnica). Paciente removido também exporta: o pedido do
// titular não deixa de valer porque o cadastro saiu da lista.
@Injectable()
export class PatientExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async export(tenantId: string, actor: AuthenticatedUser, patientId: string) {
    const patient = await this.prisma.patient.findFirst({ where: { id: patientId, tenantId } });
    if (!patient) {
      throw new NotFoundException(`Paciente ${patientId} não encontrado`);
    }

    const [tenant, records, appointments, charges] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true, branding: { select: { tradeName: true } } },
      }),
      this.prisma.anamnesisRecord.findMany({
        where: { tenantId, patientId },
        orderBy: { createdAt: 'asc' },
        include: {
          template: { select: { id: true, name: true, fields: true } },
          filledBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.appointment.findMany({
        where: { tenantId, patientId },
        orderBy: { scheduledAt: 'asc' },
        select: {
          id: true,
          scheduledAt: true,
          endsAt: true,
          status: true,
          notes: true,
          professional: { select: { id: true, name: true } },
        },
      }),
      this.prisma.charge.findMany({
        where: { tenantId, patientId },
        orderBy: { dueDate: 'asc' },
        select: {
          id: true,
          description: true,
          amountCents: true,
          dueDate: true,
          status: true,
          appointmentId: true,
          payments: {
            orderBy: { paidAt: 'asc' },
            select: { id: true, amountCents: true, method: true, paidAt: true, notes: true },
          },
        },
      }),
    ]);

    await this.audit.record(actor, {
      action: 'patient.export',
      patientId,
      details: { clinicalRecords: records.length, appointments: appointments.length, charges: charges.length },
    });

    const { tenantId: _tenantId, ...patientData } = patient;
    return {
      ...EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      clinic: { name: tenant.branding?.tradeName ?? tenant.name },
      patient: patientData,
      clinicalRecords: records.map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        form: { id: record.template.id, name: record.template.name },
        filledBy: record.filledBy,
        answers: this.readableAnswers(
          record.template.fields as unknown as AnamnesisFieldDefinition[],
          record.answers as Record<string, unknown>,
        ),
      })),
      appointments,
      charges,
    };
  }

  // Na ordem do formulário, com rótulo. O formulário pode ter sido editado depois da ficha:
  // respostas a campos que não existem mais saem no fim, com `label: null`, em vez de sumirem.
  private readableAnswers(fields: AnamnesisFieldDefinition[], answers: Record<string, unknown>) {
    const known = new Set(fields.map((field) => field.key));
    return [
      ...fields
        .filter((field) => field.key in answers)
        .map((field) => ({ key: field.key, label: field.label, type: field.type, value: answers[field.key] })),
      ...Object.keys(answers)
        .filter((key) => !known.has(key))
        .map((key) => ({ key, label: null, type: null, value: answers[key] })),
    ];
  }
}
