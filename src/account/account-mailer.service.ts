import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailSender } from '../mail/email-sender.js';
import { escapeHtml } from '../common/escape-html.js';

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
    const link = this.link(baseUrl, RESET_PATH, token);
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
    const link = this.link(baseUrl, INVITE_PATH, token);
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

  // Endereço da clínica, na mesma ordem de preferência da resolução de marca: domínio próprio
  // verificado, depois <sub>.<APP_BASE_DOMAIN>. Em dev (sem APP_BASE_DOMAIN), FRONTEND_URL com
  // ?tenant=<sub>, que é como o frontend escolhe a clínica localmente.
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
    const clinic = tenant.branding?.tradeName ?? tenant.name;
    const baseDomain = this.config.get<string>('APP_BASE_DOMAIN')?.trim().toLowerCase();

    if (tenant.customDomain && tenant.customDomainVerifiedAt) {
      return { clinic, baseUrl: { origin: `https://${tenant.customDomain}` } };
    }
    if (baseDomain) {
      return { clinic, baseUrl: { origin: `https://${tenant.subdomain}.${baseDomain}` } };
    }
    const frontendUrl = (this.config.get<string>('FRONTEND_URL')?.trim() || 'http://localhost:5173').replace(/\/+$/, '');
    return { clinic, baseUrl: { origin: frontendUrl, tenant: tenant.subdomain } };
  }

  private link(baseUrl: { origin: string; tenant?: string }, path: string, token: string) {
    const url = new URL(path, baseUrl.origin);
    url.searchParams.set('token', token);
    if (baseUrl.tenant) {
      url.searchParams.set('tenant', baseUrl.tenant);
    }
    return url.toString();
  }
}
