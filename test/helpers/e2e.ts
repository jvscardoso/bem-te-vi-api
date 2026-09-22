import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { DnsTxtResolver } from '../../src/tenants/dns-txt-resolver.js';

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
// `dnsTxtResolver`: só quem testa verificação de domínio precisa de um dublê controlável
// (não dá para apontar um TXT real num domínio de teste); os demais arquivos usam o real,
// que nunca chega a ser chamado por eles.
export async function createTestApp(opts: { dnsTxtResolver?: DnsTxtResolver } = {}): Promise<TestApp> {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ThrottlerStorage)
    .useValue({
      increment: async () => ({
        totalHits: 1,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    });
  if (opts.dnsTxtResolver) {
    builder.overrideProvider(DnsTxtResolver).useValue(opts.dnsTxtResolver);
  }
  const moduleRef = await builder.compile();

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

// Campos genéricos o bastante para servir aos testes que só precisam de um formulário
// qualquer (não estão testando o próprio formulário) — texto opcional, multiselect e boolean.
const DEFAULT_ANAMNESIS_FIELDS = [
  { key: 'queixa', label: 'Queixa principal', type: 'textarea', required: false },
  {
    key: 'alergias',
    label: 'Alergias',
    type: 'multiselect',
    required: false,
    options: ['dipirona', 'penicilina', 'nenhuma'],
  },
  { key: 'fumante', label: 'Fumante?', type: 'boolean', required: false },
];

export async function createAnamnesisTemplate(
  http: Http,
  admin: TestTenant,
  fields: Record<string, unknown>[] = DEFAULT_ANAMNESIS_FIELDS,
): Promise<{ id: string; name: string; fields: unknown[] }> {
  const res = await http()
    .post(`/tenants/${admin.tenantId}/anamnesis-templates`)
    .set(admin.auth)
    .send({ name: `Ficha ${uniq()}`, fields })
    .expect(201);
  return res.body;
}

// Provisiona um admin de plataforma como `prisma/bootstrap-platform.ts` faria — de propósito
// nunca via POST /tenants (signup público), que não tem como conceder platform:manage.
export async function createPlatformAdmin(ctx: TestApp): Promise<TestTenant> {
  const tenant = await ctx.prisma.tenant.create({
    data: { name: `Plataforma ${uniq()}`, subdomain: `platform-${uniq()}`, isPlatform: true },
  });
  const permission = await ctx.prisma.permission.findUniqueOrThrow({ where: { key: 'platform:manage' } });
  const role = await ctx.prisma.role.create({
    data: { tenantId: tenant.id, name: 'Platform Admin', description: 'Acesso ao backoffice' },
  });
  await ctx.prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  const email = `platform-admin-${uniq()}@teste.com`;
  await ctx.prisma.user.create({
    data: { tenantId: tenant.id, roleId: role.id, name: 'Platform Admin', email, passwordHash: await hash(PASSWORD, 4) },
  });
  const owner = await loginAs(ctx.http, email);
  return { ...owner, tenantId: tenant.id, roleId: role.id };
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
  await prisma.anamnesisTemplate.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.appointment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.patient.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}
