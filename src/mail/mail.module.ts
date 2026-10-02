import { Module } from '@nestjs/common';
import { EmailSender, SmtpEmailSender } from './email-sender.js';

@Module({
  providers: [{ provide: EmailSender, useClass: SmtpEmailSender }],
  exports: [EmailSender],
})
export class MailModule {}
