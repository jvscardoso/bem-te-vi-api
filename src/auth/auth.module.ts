import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { TenantAccessGuard } from './guards/tenant-access.guard.js';
import { PermissionsGuard } from './guards/permissions.guard.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AccountModule } from '../account/account.module.js';
import { LegalModule } from '../legal/legal.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { SessionsService } from './sessions.service.js';
import { LoginAttemptsService } from './login-attempts.service.js';

@Module({
  imports: [
    PassportModule,
    // TenantHostResolver: o login restringe à clínica do host com a mesma regra da marca pública.
    TenantsModule,
    // Tokens e emails de recuperação de senha e convite.
    AccountModule,
    // Aceite de Termos/Política no convite e em /auth/me.
    LegalModule,
    // Bloqueio de login por tentativas vai para a trilha da clínica.
    AuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // Token de acesso curto: um token vazado vale por poucos minutos. A sessão continua pelo
      // refresh token (ver SessionsService).
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    LoginAttemptsService,
    JwtStrategy,
    JwtAuthGuard,
    TenantAccessGuard,
    PermissionsGuard,
  ],
  exports: [JwtAuthGuard, TenantAccessGuard, PermissionsGuard],
})
export class AuthModule {}
