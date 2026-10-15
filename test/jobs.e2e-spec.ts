import { randomUUID } from 'node:crypto';
import { cleanupTenants, createTestApp, FakeJobQueue, signupTenant, type TestApp, type TestTenant } from './helpers/e2e.js';
import { MAINTENANCE_CLEANUP } from '../src/jobs/maintenance.jobs.js';

const DAY = 24 * 60 * 60 * 1000;

// Fila e agendador (pg-boss). Os outros arquivos usam o dublê FakeJobQueue; este sobe o pg-boss
// de verdade, contra o mesmo Postgres, para provar que a fila liga, agenda e executa.
describe('Fila de jobs (e2e)', () => {
  describe('faxina diária (com o dublê)', () => {
    let ctx: TestApp;
    let queue: FakeJobQueue;
    let a: TestTenant;

    beforeAll(async () => {
      queue = new FakeJobQueue();
      ctx = await createTestApp({ jobQueue: queue });
      a = await signupTenant(ctx.http, 'faxina');
    });

    afterAll(async () => {
      await cleanupTenants(ctx.prisma, [a?.tenantId]);
      await ctx.app.close();
    });

    it('fica agendada todo dia às 3h de Brasília', () => {
      expect(queue.registered(MAINTENANCE_CLEANUP)).toMatchObject({ cron: '0 3 * * *', tz: 'America/Sao_Paulo' });
    });

    it('apaga sessões vencidas há mais de um dia e contadores de login parados; mantém o resto', async () => {
      const old = await ctx.prisma.session.create({
        data: { userId: a.id, passwordVersion: 0, expiresAt: new Date(Date.now() - 2 * DAY) },
      });
      const recent = await ctx.prisma.session.create({
        data: { userId: a.id, passwordVersion: 0, expiresAt: new Date(Date.now() - 60_000) },
      });
      const stale = randomUUID().replace(/-/g, '').padEnd(64, '0');
      const locked = randomUUID().replace(/-/g, '').padEnd(64, '1');
      await ctx.prisma.loginAttempt.createMany({
        data: [
          { emailHash: stale, failedCount: 3, windowStartedAt: new Date(Date.now() - 2 * DAY) },
          // Bloqueio ainda valendo: fica, mesmo com a janela antiga.
          { emailHash: locked, failedCount: 0, windowStartedAt: new Date(Date.now() - 2 * DAY), lockedUntil: new Date(Date.now() + DAY) },
        ],
      });

      await queue.run(MAINTENANCE_CLEANUP);

      expect(await ctx.prisma.session.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await ctx.prisma.session.findUnique({ where: { id: recent.id } })).not.toBeNull();
      expect(await ctx.prisma.loginAttempt.findUnique({ where: { emailHash: stale } })).toBeNull();
      expect(await ctx.prisma.loginAttempt.findUnique({ where: { emailHash: locked } })).not.toBeNull();
      await ctx.prisma.loginAttempt.delete({ where: { emailHash: locked } });
    });
  });

  describe('pg-boss de verdade', () => {
    let ctx: TestApp;
    let a: TestTenant;

    beforeAll(async () => {
      ctx = await createTestApp({ jobQueue: 'real' });
      a = await signupTenant(ctx.http, 'pgboss');
    });

    afterAll(async () => {
      await cleanupTenants(ctx.prisma, [a?.tenantId]);
      await ctx.app.close();
    });

    it('cria a fila, grava o agendamento diário e executa um job enviado', async () => {
      const schedules = await ctx.prisma.$queryRaw<{ cron: string; timezone: string }[]>`
        SELECT cron, timezone FROM pgboss.schedule WHERE name = ${MAINTENANCE_CLEANUP}`;
      expect(schedules[0]).toMatchObject({ cron: '0 3 * * *', timezone: 'America/Sao_Paulo' });

      const old = await ctx.prisma.session.create({
        data: { userId: a.id, passwordVersion: 0, expiresAt: new Date(Date.now() - 2 * DAY) },
      });
      const { JobQueue } = await import('../src/jobs/job-queue.js');
      await ctx.app.get(JobQueue).send(MAINTENANCE_CLEANUP);

      await vi.waitFor(
        async () => expect(await ctx.prisma.session.findUnique({ where: { id: old.id } })).toBeNull(),
        { timeout: 30_000, interval: 500 },
      );
    }, 60_000);
  });
});
