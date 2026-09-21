import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Roda contra o Postgres do .env (precisa de `docker compose up -d` + migrate + seed).
// Cada execução usa um sufixo único e remove o que criou no final.
const run = Date.now().toString(36);
const PASSWORD = 'Senha@12345';

interface Signup {
  tenantId: string;
  roleId: string;
  email: string;
  token: string;
}

describe('Autenticação e autorização (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let a: Signup;
  let b: Signup;

  const http = () => request(app.getHttpServer());

  function login(email: string, password = PASSWORD) {
    return http().post('/auth/login').send({ email, password });
  }

  async function signup(name: string): Promise<Signup> {
    const email = `dono-${name}-${run}@teste.com`;
    const res = await http()
      .post('/tenants')
      .send({
        name: `Clinica ${name} ${run}`,
        subdomain: `clinica-${name}-${run}`,
        owner: { name: `Dono ${name}`, email, password: PASSWORD },
      })
      .expect(201);
    const token = (await login(email).expect(200)).body.accessToken as string;
    return { tenantId: res.body.tenant.id, roleId: res.body.role.id, email, token };
  }

  const auth = (s: Signup) => ({ Authorization: `Bearer ${s.token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // O limite de 5 logins/min atrapalharia a suíte; um storage que nunca acumula hits
      // desliga o rate limit sem mexer no guard (registrado via APP_GUARD).
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

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    a = await signup('a');
    b = await signup('b');
  });

  afterAll(async () => {
    const tenantIds = [a?.tenantId, b?.tenantId].filter(Boolean);
    // Users antes do tenant: o FK role -> user é Restrict e bloquearia a cascata.
    await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await app.close();
  });

  describe('signup e login', () => {
    it('recusa email duplicado no signup', async () => {
      await http()
        .post('/tenants')
        .send({
          name: 'Dup',
          subdomain: `dup-${run}`,
          owner: { name: 'Dup', email: a.email, password: PASSWORD },
        })
        .expect(409);
    });

    it('login é case-insensitive no email e a resposta traz tenant e permissões', async () => {
      const res = await login(a.email.toUpperCase()).expect(200);
      expect(res.body.user.tenantId).toBe(a.tenantId);
      expect(res.body.user.permissions).toContain('tenant:manage');
    });

    it('senha errada e email inexistente dão a mesma resposta 401', async () => {
      const wrongPassword = await login(a.email, 'errada').expect(401);
      const unknownEmail = await login(`nao-existe-${run}@teste.com`).expect(401);
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });

    it('rejeita body inválido (campo extra, email malformado)', async () => {
      await http()
        .post('/auth/login')
        .send({ email: a.email, password: PASSWORD, x: 1 })
        .expect(400);
      await http().post('/auth/login').send({ email: 'naoemail', password: 'x' }).expect(400);
    });
  });

  describe('rotas protegidas e isolamento de tenant', () => {
    it('exige token válido', async () => {
      await http().get(`/tenants/${a.tenantId}/patients`).expect(401);
      await http()
        .get(`/tenants/${a.tenantId}/patients`)
        .set('Authorization', 'Bearer lixo.lixo.lixo')
        .expect(401);
    });

    it('permite o próprio tenant e bloqueia o de outro', async () => {
      await http().get(`/tenants/${a.tenantId}/patients`).set(auth(a)).expect(200);
      await http().get(`/tenants/${b.tenantId}/patients`).set(auth(a)).expect(403);
      await http().get(`/tenants/${b.tenantId}`).set(auth(a)).expect(403);
    });
  });

  describe('permissões (RBAC)', () => {
    let recep: Signup;

    beforeAll(async () => {
      const readPatients = await prisma.permission.findUniqueOrThrow({
        where: { key: 'patients:read' },
      });
      const role = await http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(auth(a))
        .send({ name: 'Recepcao', permissionIds: [readPatients.id] })
        .expect(201);
      const email = `recep-${run}@teste.com`;
      await http()
        .post(`/tenants/${a.tenantId}/users`)
        .set(auth(a))
        .send({ name: 'Recep', email, password: PASSWORD, roleId: role.body.id })
        .expect(201);
      const token = (await login(email).expect(200)).body.accessToken as string;
      recep = { tenantId: a.tenantId, roleId: role.body.id, email, token };
    });

    it('papel restrito só faz o que a permissão libera', async () => {
      await http().get(`/tenants/${a.tenantId}/patients`).set(auth(recep)).expect(200);
      await http()
        .post(`/tenants/${a.tenantId}/patients`)
        .set(auth(recep))
        .send({ fullName: 'Fulano' })
        .expect(403);
      await http().get(`/tenants/${a.tenantId}/users`).set(auth(recep)).expect(403);
      await http()
        .patch(`/tenants/${a.tenantId}/branding`)
        .set(auth(recep))
        .send({ primaryColor: '#ff0000' })
        .expect(403);
    });

    it('mudança de permissões do papel vale imediatamente, sem novo login', async () => {
      const writePatients = await prisma.permission.findUniqueOrThrow({
        where: { key: 'patients:write' },
      });
      await http()
        .patch(`/tenants/${a.tenantId}/roles/${recep.roleId}`)
        .set(auth(a))
        .send({ permissionIds: [writePatients.id] })
        .expect(200);

      await http().get(`/tenants/${a.tenantId}/patients`).set(auth(recep)).expect(403);
      await http()
        .post(`/tenants/${a.tenantId}/patients`)
        .set(auth(recep))
        .send({ fullName: 'Fulano' })
        .expect(201);
    });

    it('usuário desativado perde acesso imediatamente e não loga mais', async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: recep.email } });
      await http()
        .patch(`/tenants/${a.tenantId}/users/${user.id}`)
        .set(auth(a))
        .send({ status: 'disabled' })
        .expect(200);

      await http().get(`/tenants/${a.tenantId}/patients`).set(auth(recep)).expect(401);
      await login(recep.email).expect(401);
    });
  });

  describe('tenant suspenso', () => {
    it('admin do cliente não consegue alterar o status do próprio tenant', async () => {
      await http()
        .patch(`/tenants/${b.tenantId}`)
        .set(auth(b))
        .send({ status: 'suspended' })
        .expect(400);
    });

    it('bloqueia login e tokens já emitidos', async () => {
      await http().get(`/tenants/${b.tenantId}/patients`).set(auth(b)).expect(200);

      await prisma.tenant.update({ where: { id: b.tenantId }, data: { status: 'suspended' } });

      await login(b.email).expect(401);
      await http().get(`/tenants/${b.tenantId}/patients`).set(auth(b)).expect(401);
    });
  });
});
