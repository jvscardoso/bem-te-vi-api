import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueue } from './job-queue.js';

export const MAINTENANCE_CLEANUP = 'maintenance.cleanup';

// Sessões vencidas há mais de um dia e contadores de login parados há mais de um dia não servem
// mais para nada. (O login e a falha de login já limpam o que encontram pelo caminho; esta faxina
// cobre quem nunca mais loga.)
const RETENTION_MS = 24 * 60 * 60 * 1000;

// Faxina diária, de madrugada no horário de Brasília (pouco uso).
@Injectable()
export class MaintenanceJobs implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
  ) {}

  onModuleInit() {
    this.queue.register({
      name: MAINTENANCE_CLEANUP,
      cron: '0 3 * * *',
      tz: 'America/Sao_Paulo',
      handler: () => this.cleanup(),
    });
  }

  async cleanup() {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    // Os refresh tokens vão junto, em cascata.
    const sessions = await this.prisma.session.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    const attempts = await this.prisma.loginAttempt.deleteMany({
      where: { windowStartedAt: { lt: cutoff }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
    });
    this.logger.log(`Faxina: ${sessions.count} sessões e ${attempts.count} contadores de login apagados`);
  }
}
