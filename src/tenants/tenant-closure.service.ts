import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailSender } from '../mail/email-sender.js';
import { USER_SECRET_FIELDS } from '../common/user-secret-fields.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { deletionAvailableAt, deletionGraceDays } from './tenant-closure.js';
import { escapeHtml } from '../common/escape-html.js';

const EXPORT_FORMAT = { format: 'bem-te-vi.clinic-export', version: 1 } as const;

// Saída da clínica (LGPD): levar todos os dados (exportação completa) e pedir a exclusão.
// A exclusão em si é da plataforma (PlatformService.deleteTenant), só depois da carência.
@Injectable()
export class TenantClosureService {
  private readonly logger = new Logger(TenantClosureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sender: EmailSender,
    private readonly config: ConfigService,
  ) {}

  // Tudo o que a plataforma guarda da clínica, num arquivo: para a clínica levar os dados para
  // outro sistema e cumprir a guarda de prontuário depois de sair. Nada de segredo (hash de
  // senha, tokens de email, token de verificação de domínio). Montado em memória: serve ao
  // volume de uma clínica no MVP; com bases grandes, vira geração assíncrona com download depois.
  async export(tenantId: string, actor: AuthenticatedUser) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      omit: { customDomainVerificationToken: true },
      include: { branding: true, logo: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} não encontrado`);
    }

    const where = { tenantId };
    const [users, roles, patients, templates, records, appointments, charges, auditLogs, legalAcceptances] =
      await Promise.all([
        this.prisma.user.findMany({ where, omit: USER_SECRET_FIELDS, orderBy: { createdAt: 'asc' } }),
        this.prisma.role.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          include: { permissions: { select: { permission: { select: { key: true } } } } },
        }),
        this.prisma.patient.findMany({ where, orderBy: { createdAt: 'asc' } }),
        this.prisma.anamnesisTemplate.findMany({ where, orderBy: { createdAt: 'asc' } }),
        this.prisma.anamnesisRecord.findMany({ where, orderBy: { createdAt: 'asc' } }),
        this.prisma.appointment.findMany({ where, orderBy: { scheduledAt: 'asc' } }),
        this.prisma.charge.findMany({ where, orderBy: { dueDate: 'asc' }, include: { payments: { orderBy: { paidAt: 'asc' } } } }),
        this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } }),
        this.prisma.legalAcceptance.findMany({ where, orderBy: { acceptedAt: 'asc' } }),
      ]);

    await this.audit.record(actor, {
      action: 'tenant.export',
      details: { patients: patients.length, clinicalRecords: records.length, appointments: appointments.length },
    });

    const { logo, ...clinic } = tenant;
    return {
      ...EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      clinic,
      logo: logo ? { mimeType: logo.mimeType, base64: Buffer.from(logo.data).toString('base64') } : null,
      users,
      roles: roles.map(({ permissions, ...role }) => ({ ...role, permissions: permissions.map((p) => p.permission.key) })),
      patients,
      anamnesisTemplates: templates,
      anamnesisRecords: records,
      appointments,
      charges,
      auditLogs,
      legalAcceptances,
    };
  }

  // Pedido de encerramento. Exige a senha de quem pede (além de tenant:manage): é o passo que
  // leva à exclusão de todos os dados, então um token esquecido aberto não basta.
  async requestClosure(tenantId: string, actor: AuthenticatedUser, password: string) {
    const [tenant, user] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true, closureRequestedAt: true },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { name: true, email: true, passwordHash: true },
      }),
    ]);
    // 400, não 401: 401 significa "sessão inválida" para o cliente, que deslogaria o usuário.
    if (!(await compare(password, user.passwordHash))) {
      throw new BadRequestException('Senha incorreta');
    }
    if (tenant.closureRequestedAt) {
      throw new ConflictException('O encerramento desta clínica já foi pedido');
    }

    const closureRequestedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { closureRequestedAt, closureRequestedByUserId: actor.userId },
      });
      await this.audit.record(actor, { action: 'tenant.closure_requested' }, tx);
    });

    const availableAt = deletionAvailableAt(closureRequestedAt, this.config);
    this.notifyClosure(tenant.name, user, availableAt);
    return this.closureView(closureRequestedAt);
  }

  async cancelClosure(tenantId: string, actor: AuthenticatedUser) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { closureRequestedAt: true },
    });
    if (!tenant.closureRequestedAt) {
      throw new ConflictException('Não há pedido de encerramento para cancelar');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { closureRequestedAt: null, closureRequestedByUserId: null },
      });
      await this.audit.record(actor, { action: 'tenant.closure_cancelled' }, tx);
    });
    return this.closureView(null);
  }

  closureView(closureRequestedAt: Date | null) {
    return {
      closureRequestedAt,
      deletionAvailableAt: closureRequestedAt ? deletionAvailableAt(closureRequestedAt, this.config) : null,
      graceDays: deletionGraceDays(this.config),
    };
  }

  // Confirmação para quem pediu e aviso para a plataforma (PLATFORM_CONTACT_EMAIL), em segundo
  // plano: falha de email não desfaz o pedido, fica no log.
  private notifyClosure(clinic: string, requester: { name: string; email: string }, availableAt: Date) {
    const date = availableAt.toISOString().slice(0, 10);
    const messages = [
      this.sender.send({
        to: requester.email,
        subject: `${clinic}: pedido de encerramento da conta`,
        text:
          `Olá, ${requester.name}.\n\nRecebemos o pedido de encerramento da conta de ${clinic}. ` +
          `Os dados poderão ser excluídos definitivamente a partir de ${date}.\n\n` +
          `Até lá, a clínica continua funcionando: exporte os dados em Configurações > Encerrar conta, ` +
          `ou cancele o pedido se ele foi feito por engano.`,
        html:
          `<p>Olá, ${escapeHtml(requester.name)}.</p><p>Recebemos o pedido de encerramento da conta de ` +
          `<strong>${escapeHtml(clinic)}</strong>. Os dados poderão ser excluídos definitivamente a partir de ` +
          `<strong>${date}</strong>.</p><p>Até lá, a clínica continua funcionando: exporte os dados em ` +
          `Configurações › Encerrar conta, ou cancele o pedido se ele foi feito por engano.</p>`,
      }),
    ];
    const platformContact = this.config.get<string>('PLATFORM_CONTACT_EMAIL')?.trim();
    if (platformContact) {
      messages.push(
        this.sender.send({
          to: platformContact,
          subject: `Encerramento pedido: ${clinic}`,
          text: `${clinic} pediu o encerramento da conta (por ${requester.email}). Exclusão liberada a partir de ${date}.`,
          html: `<p>${escapeHtml(clinic)} pediu o encerramento da conta (por ${escapeHtml(requester.email)}). Exclusão liberada a partir de ${date}.</p>`,
        }),
      );
    }
    Promise.all(messages).catch((error: unknown) =>
      this.logger.error(`Falha ao enviar email de encerramento: ${error instanceof Error ? error.message : error}`),
    );
  }
}
