import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export const PASSWORD = 'Senha@12345';

// Sufixo único por execução/arquivo: emails e subdomains são únicos globalmente no banco,
// e os arquivos de e2e rodam em paralelo contra o mesmo Postgres.
export const uniq = () => randomUUID().slice(0, 8);

export type Http = () => ReturnType<typeof request>;

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  http: Http;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  auth: { Authorization: string };
}

export interface TestTenant extends TestUser {
  tenantId: string;
  roleId: string;
}

// Sobe a aplicação com a mesma configuração de validação do main.ts.
// O rate limit é desligado: um storage que nunca acumula hits evita 429 na suíte
// sem mexer no guard (registrado via APP_GUARD).
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ThrottlerStorage)
    .useValue({
      increment: async () => ({
        totalHits: 1,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();

  return { app, prisma: app.get(PrismaService), http: () => request(app.getHttpServer()) };
}

export async function loginAs(http: Http, email: string): Promise<TestUser> {
  const res = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
  const token = res.body.accessToken as string;
  return { id: res.body.user.id, email, token, auth: { Authorization: `Bearer ${token}` } };
}

// Signup público: cria tenant + role Admin (todas as permissões) + dono, e já loga o dono.
export async function signupTenant(http: Http, label: string): Promise<TestTenant> {
  const suffix = uniq();
  const email = `dono-${label}-${suffix}@teste.com`;
  const res = await http()
    .post('/tenants')
    .send({
      name: `Clinica ${label} ${suffix}`,
      subdomain: `clinica-${label}-${suffix}`,
      owner: { name: `Dono ${label}`, email, password: PASSWORD },
    })
    .expect(201);
  const owner = await loginAs(http, email);
  return { ...owner, tenantId: res.body.tenant.id, roleId: res.body.role.id };
}

// Cria um usuário (profissional) no tenant do `admin` e já loga.
export async function createUser(
  http: Http,
  admin: TestTenant,
  label: string,
  extra: { roleId?: string; defaultAppointmentDurationMinutes?: number } = {},
): Promise<TestUser> {
  const email = `${label}-${uniq()}@teste.com`;
  await http()
    .post(`/tenants/${admin.tenantId}/users`)
    .set(admin.auth)
    .send({ name: label, email, password: PASSWORD, roleId: admin.roleId, ...extra })
    .expect(201);
  return loginAs(http, email);
}

export async function createPatient(
  http: Http,
  admin: TestTenant,
  data: Record<string, unknown> = {},
): Promise<{ id: string; fullName: string }> {
  const res = await http()
    .post(`/tenants/${admin.tenantId}/patients`)
    .set(admin.auth)
    .send({ fullName: `Paciente x${uniq()}`, ...data })
    .expect(201);
  return res.body;
}

export async function permissionIds(prisma: PrismaService, keys: string[]): Promise<string[]> {
  const rows = await prisma.permission.findMany({ where: { key: { in: keys } } });
  return rows.map((row) => row.id);
}

// Ordem importa: vários FKs são Restrict (anamnese -> usuário, agendamento -> profissional,
// usuário -> role) e bloqueariam a cascata direta a partir do tenant.
export async function cleanupTenants(prisma: PrismaService, tenantIds: (string | undefined)[]) {
  const ids = tenantIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) {
    return;
  }
  await prisma.anamnesisRecord.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.patient.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}
