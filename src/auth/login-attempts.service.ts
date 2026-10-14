import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

// 10 senhas erradas em 15 minutos bloqueiam a conta por 15 minutos. O rate limit por IP (5/min)
// continua valendo; isto pega o ataque espalhado por muitos IPs contra uma conta só. Durante o
// bloqueio, nem a senha certa entra, e a resposta é a mesma "Credenciais inválidas" de sempre.
// Quem foi bloqueado por terceiros pode redefinir a senha pelo email, o que zera o bloqueio
// (AuthService.resetPassword).
const MAX_FAILURES = 10;
const WINDOW_SECONDS = 15 * 60;
const LOCK_MS = 15 * 60 * 1000;
// Contadores parados há mais de um dia não servem para nada: são apagados nas próximas falhas.
const STALE_SECONDS = 24 * 60 * 60;

const hashEmail = (email: string) => createHash('sha256').update(email.toLowerCase()).digest('hex');

@Injectable()
export class LoginAttemptsService {
  constructor(private readonly prisma: PrismaService) {}

  async isLocked(email: string): Promise<boolean> {
    const row = await this.prisma.loginAttempt.findUnique({
      where: { emailHash: hashEmail(email) },
      select: { lockedUntil: true },
    });
    return row?.lockedUntil != null && row.lockedUntil > new Date();
  }

  // Conta uma senha errada. Devolve true quando é esta falha que bloqueia a conta (para registrar
  // o bloqueio uma vez só). O incremento é atômico no banco: tentativas simultâneas não se perdem.
  async recordFailure(email: string): Promise<boolean> {
    const emailHash = hashEmail(email);
    await this.prisma.$executeRaw`
      DELETE FROM login_attempts
      WHERE window_started_at < now() - ${STALE_SECONDS} * interval '1 second'
        AND (locked_until IS NULL OR locked_until < now())`;
    const [row] = await this.prisma.$queryRaw<{ failed_count: number }[]>`
      INSERT INTO login_attempts (email_hash, failed_count, window_started_at)
      VALUES (${emailHash}, 1, now())
      ON CONFLICT (email_hash) DO UPDATE SET
        failed_count = CASE
          WHEN login_attempts.window_started_at < now() - ${WINDOW_SECONDS} * interval '1 second' THEN 1
          ELSE login_attempts.failed_count + 1
        END,
        window_started_at = CASE
          WHEN login_attempts.window_started_at < now() - ${WINDOW_SECONDS} * interval '1 second' THEN now()
          ELSE login_attempts.window_started_at
        END
      RETURNING failed_count`;
    if (row.failed_count < MAX_FAILURES) {
      return false;
    }
    // Bloqueia e zera o contador: quando o bloqueio acabar, a conta tem as 10 tentativas de novo.
    // Condicional, para duas falhas simultâneas não bloquearem (e registrarem) duas vezes.
    const now = new Date();
    const locked = await this.prisma.loginAttempt.updateMany({
      where: { emailHash, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: new Date(now.getTime() + LOCK_MS), failedCount: 0, windowStartedAt: now },
    });
    return locked.count > 0;
  }

  async clear(email: string) {
    await this.prisma.loginAttempt.deleteMany({ where: { emailHash: hashEmail(email) } });
  }
}
