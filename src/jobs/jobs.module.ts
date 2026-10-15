import { Global, Module } from '@nestjs/common';
import { JobQueue, PgBossJobQueue } from './job-queue.js';
import { MaintenanceJobs } from './maintenance.jobs.js';

// Global: qualquer módulo injeta JobQueue para registrar os próprios jobs (lembretes, campanhas).
@Global()
@Module({
  providers: [{ provide: JobQueue, useClass: PgBossJobQueue }, MaintenanceJobs],
  exports: [JobQueue],
})
export class JobsModule {}
