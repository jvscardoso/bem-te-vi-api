import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { UserTokensService } from './user-tokens.service.js';
import { AccountMailerService } from './account-mailer.service.js';

// Links de conta enviados por email: recuperação de senha (AuthModule) e convite (UsersModule).
@Module({
  imports: [MailModule],
  providers: [UserTokensService, AccountMailerService],
  exports: [UserTokensService, AccountMailerService],
})
export class AccountModule {}
