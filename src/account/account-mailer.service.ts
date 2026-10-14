import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailSender } from '../mail/email-sender.js';
import { escapeHtml } from '../common/escape-html.js';
import { clinicBaseUrl, clinicLink } from './clinic-url.js';

// Rotas do frontend que recebem o token (?token=...).
const RESET_PATH = '/reset-password';
const INVITE_PATH = '/accept-invite';

interface Recipient {
  name: string;
  email: string;
  tenantId: string;
}

// Monta e envia os emails de conta com a marca da clínica e o link para o endereço DELA.
// O link nunca vem do request (host/Origin): se viesse, quem pedisse a recuperação da senha de
// outra pessoa informando um host próprio receberia o token nesse host (host header injection).
@Injectable()
export class AccountMailerService {
  private readonly logger = new Logger(AccountMailerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: EmailSender,
    private readonly config: ConfigService,
  ) {}

  async sendPasswordReset(user: Recipient, token: string) {
    const { clinic, baseUrl } = await this.clinicOf(user.tenantId);
    const link = clinicLink(baseUrl, RESET_PATH, token);
    await this.sender.send({
      to: user.email,
      subject: `${clinic}: redefinição de senha`,
      text:
        `Olá, ${user.name}.\n\n` +
        `Recebemos um pedido para redefinir sua senha em ${clinic}. Para criar uma nova senha, acesse:\n${link}\n\n` +
        `O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu, ignore este email: sua senha continua a mesma.`,
      html:
        `<p>Olá, ${escapeHtml(user.name)}.</p>` +
        `<p>Recebemos um pedido para redefinir sua senha em <strong>${escapeHtml(clinic)}</strong>.</p>` +
        `<p><a href="${escapeHtml(link)}">Criar uma nova senha</a></p>` +
        `<p>O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu, ignore este email: sua senha continua a mesma.</p>`,
    });
  }

  async sendInvite(user: Recipient, token: string) {
    const { clinic, baseUrl } = await this.clinicOf(user.tenantId);
    const link = clinicLink(baseUrl, INVITE_PATH, token);
    await this.sender.send({
      to: user.email,
      subject: `Convite para acessar ${clinic}`,
      text:
        `Olá, ${user.name}.\n\n` +
        `Você foi convidado para acessar ${clinic}. Para criar sua senha e entrar, acesse:\n${link}\n\n` +
        `O convite vale por 7 dias.`,
      html:
        `<p>Olá, ${escapeHtml(user.name)}.</p>` +
        `<p>Você foi convidado para acessar <strong>${escapeHtml(clinic)}</strong>.</p>` +
        `<p><a href="${escapeHtml(link)}">Criar minha senha</a></p>` +
        `<p>O convite vale por 7 dias.</p>`,
    });
  }

  // Envio em segundo plano: a resposta não espera o SMTP (lento, e no "esqueci minha senha" o
  // tempo de resposta revelaria se o email existe). Falha fica no log; o convite pode ser
  // reenviado e a recuperação, pedida de novo.
  dispatch(work: Promise<void>, description: string) {
    work.catch((error: unknown) =>
      this.logger.error(`Falha ao enviar email (${description}): ${error instanceof Error ? error.message : error}`),
    );
  }

  // Nome e endereço da clínica (regra do endereço em clinicBaseUrl).
  private async clinicOf(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        name: true,
        subdomain: true,
        customDomain: true,
        customDomainVerifiedAt: true,
        branding: { select: { tradeName: true } },
      },
    });
    const baseUrl = clinicBaseUrl(tenant, {
      baseDomain: this.config.get<string>('APP_BASE_DOMAIN'),
      frontendUrl: this.config.get<string>('FRONTEND_URL'),
    });
    return { clinic: tenant.branding?.tradeName ?? tenant.name, baseUrl };
  }
}
