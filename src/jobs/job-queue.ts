import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgBoss } from 'pg-boss';

export interface JobDefinition<T extends object = object> {
  // Nome da fila (ex.: "maintenance.cleanup").
  name: string;
  // Processa um job. Lançar um erro faz a fila tentar de novo (até `retryLimit`).
  handler: (data: T) => Promise<void>;
  // Cron, para jobs periódicos (ex.: "0 3 * * *"). Avaliado no fuso `tz`.
  cron?: string;
  tz?: string;
  retryLimit?: number;
}

// Fila e agendador de tarefas (lembretes, novas tentativas de envio, campanhas, limpezas).
// Plugável, como o EmailSender: a implementação real é o pg-boss, dentro do próprio Postgres, sem
// serviço novo para hospedar; nos testes e2e, um dublê que roda o job na hora.
// Os módulos registram os jobs no início (onModuleInit); a fila liga tudo quando o app termina de
// subir (onApplicationBootstrap), depois que todos registraram.
export abstract class JobQueue {
  protected readonly definitions = new Map<string, JobDefinition>();

  register<T extends object>(definition: JobDefinition<T>) {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Job ${definition.name} registrado duas vezes`);
    }
    this.definitions.set(definition.name, definition as JobDefinition);
  }

  abstract send(name: string, data?: object): Promise<void>;
}

@Injectable()
export class PgBossJobQueue extends JobQueue implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('JobQueue');
  private readonly boss: PgBoss;

  constructor(config: ConfigService) {
    super();
    // Schema próprio ("pgboss"): as tabelas da fila não se misturam com as do Prisma, e o
    // `prisma migrate` não as enxerga. O pg-boss cria e migra o schema sozinho ao subir, com trava
    // no banco: várias réplicas subindo juntas não disputam.
    this.boss = new PgBoss({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      schema: 'pgboss',
      application_name: 'bem-te-vi-jobs',
    });
    this.boss.on('error', (error: Error) => this.logger.error(`Erro na fila: ${error.message}`));
  }

  async onApplicationBootstrap() {
    await this.boss.start();
    for (const definition of this.definitions.values()) {
      await this.boss.createQueue(definition.name, { retryLimit: definition.retryLimit ?? 3 });
      await this.boss.work(definition.name, async (jobs) => {
        for (const job of jobs) {
          await definition.handler(job.data as object);
        }
      });
      // schedule() é um upsert pela fila: chamar a cada subida (e em cada réplica) não duplica.
      if (definition.cron) {
        await this.boss.schedule(definition.name, definition.cron, null, { tz: definition.tz ?? 'UTC' });
      }
    }
  }

  // Espera os jobs em andamento terminarem (até 30 s) antes de o processo sair.
  async onApplicationShutdown() {
    await this.boss.stop({ graceful: true, timeout: 30_000 });
  }

  async send(name: string, data: object = {}) {
    if (!this.definitions.has(name)) {
      throw new Error(`Job ${name} não registrado`);
    }
    await this.boss.send(name, data);
  }
}
