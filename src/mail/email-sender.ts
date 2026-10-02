import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// Peça plugável (mesmo espírito do DnsTxtResolver): o resto do app só conhece `send`. Os testes
// trocam por um dublê que guarda as mensagens; trocar de provedor é só configuração de SMTP.
export abstract class EmailSender {
  abstract send(message: EmailMessage): Promise<void>;
}

// SMTP genérico: serve a qualquer provedor (Resend, SES, Brevo, Postmark...) e ao Mailpit do
// docker-compose em dev. Sem SMTP_HOST configurado, só registra no log — a API sobe sem email
// configurado e o link aparece no console (útil em dev, nunca em produção).
@Injectable()
export class SmtpEmailSender extends EmailSender {
  private readonly logger = new Logger(SmtpEmailSender.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    super();
    const host = config.get<string>('SMTP_HOST')?.trim();
    this.from = config.get<string>('MAIL_FROM')?.trim() || 'bem-te-vi <nao-responda@bemtevi.local>';
    this.transporter = host
      ? createTransport({
          host,
          port: Number(config.get<string>('SMTP_PORT') ?? 587),
          // true só na porta 465 (TLS direto); nas demais o nodemailer negocia STARTTLS sozinho.
          secure: config.get<string>('SMTP_SECURE') === 'true',
          auth: config.get<string>('SMTP_USER')
            ? { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') }
            : undefined,
        })
      : null;
    if (!this.transporter) {
      this.logger.warn('SMTP_HOST não configurado: emails serão só registrados no log');
    }
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[email não enviado] para=${message.to} assunto="${message.subject}"\n${message.text}`);
      return;
    }
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}
