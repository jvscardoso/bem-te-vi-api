import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  cleanupTenants,
  createPatient,
  createTestApp,
  createUser,
  permissionIds,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
  type TestUser,
} from './helpers/e2e.js';

// appointments:attend: só quem atende pacientes é profissional (lista de profissionais, alvo de
// agendamento, duração própria). Cenário: o dono (Admin, tudo), uma médica (attend + agenda
// própria), uma recepção (agenda de todos, sem attend) e um papel de leitura sem nada disso.
describe('Permissão appointments:attend (e2e)', () => {
  let ctx: TestApp;
  let owner: TestTenant;
  let other: TestTenant;
  let doctor: TestUser;
  let reception: TestUser;
  let readOnly: TestUser;
  let patient: { id: string };

  const base = () => `/tenants/${owner.tenantId}`;
  const schedule = (as: Pick<TestUser, 'auth'>, professionalId: string, scheduledAt: string) =>
    ctx.http().post(`${base()}/appointments`).set(as.auth).send({ patientId: patient.id, professionalId, scheduledAt });

  async function createRole(name: string, keys: string[]) {
    const res = await ctx
      .http()
      .post(`${base()}/roles`)
      .set(owner.auth)
      .send({ name: `${name} ${uniq()}`, permissionIds: await permissionIds(ctx.prisma, keys) })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await signupTenant(ctx.http, 'attend');
    other = await signupTenant(ctx.http, 'attend-outra');
    patient = await createPatient(ctx.http, owner);

    const doctorRoleId = await createRole('Medica', ['appointments:read', 'appointments:write', 'appointments:attend']);
    const receptionRoleId = await createRole('Recepcao', ['appointments:read', 'appointments:write', 'appointments:all']);
    const readOnlyRoleId = await createRole('Leitura', ['appointments:read']);
    doctor = await createUser(ctx.http, owner, 'medica-attend', { roleId: doctorRoleId });
    reception = await createUser(ctx.http, owner, 'recepcao-attend', { roleId: receptionRoleId });
    readOnly = await createUser(ctx.http, owner, 'leitura-attend', { roleId: readOnlyRoleId });
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [owner?.tenantId, other?.tenantId]);
    await ctx.app.close();
  });

  it('a permissão está no catálogo, com descrição em português', async () => {
    const res = await ctx.http().get('/permissions').set(owner.auth).expect(200);
    const attend = res.body.find((p: { key: string }) => p.key === 'appointments:attend');
    expect(attend.description).toMatch(/Atende pacientes/);
  });

  it('a clínica nova nasce com attend no papel Admin', async () => {
    const me = await ctx.http().get('/auth/me').set(owner.auth).expect(200);
    expect(me.body.permissions).toContain('appointments:attend');
  });

  describe('GET /professionals', () => {
    const professionals = (as: Pick<TestUser, 'auth'>) => ctx.http().get(`${base()}/professionals`).set(as.auth);

    it('com appointments:all: só os ativos que atendem (a recepção não aparece)', async () => {
      const res = await professionals(reception).expect(200);
      const ids = res.body.map((p: { id: string }) => p.id);
      expect(ids).toEqual(expect.arrayContaining([owner.id, doctor.id]));
      expect(ids).not.toContain(reception.id);
      expect(ids).not.toContain(readOnly.id);
    });

    it('sem appointments:all: o próprio usuário, se atende; senão, lista vazia', async () => {
      const own = await professionals(doctor).expect(200);
      expect(own.body.map((p: { id: string }) => p.id)).toEqual([doctor.id]);

      const none = await professionals(readOnly).expect(200);
      expect(none.body).toEqual([]);
    });
  });

  describe('agendamentos', () => {
    it('profissional sem attend → 400 "Este usuário não atende pacientes"', async () => {
      const res = await schedule(owner, reception.id, '2031-06-02T13:00:00.000Z').expect(400);
      expect(res.body.message).toBe('Este usuário não atende pacientes');
    });

    it('profissional de outra clínica continua sendo 400 de profissional inválido', async () => {
      const res = await schedule(owner, other.id, '2031-06-02T14:00:00.000Z').expect(400);
      expect(res.body.message).toBe('professionalId inválido para este tenant');
    });

    it('agendamento antigo de quem perdeu attend: edita sem trocar o profissional, mas não troca para quem não atende', async () => {
      const roleId = await createRole('Ex-medico', ['appointments:read', 'appointments:write', 'appointments:attend']);
      const former = await createUser(ctx.http, owner, 'ex-medico-attend', { roleId });
      const appointment = (await schedule(owner, former.id, '2031-06-03T13:00:00.000Z').expect(201)).body;

      // O papel perde a permissão: o agendamento continua lá, como histórico.
      await ctx
        .http()
        .patch(`${base()}/roles/${roleId}`)
        .set(owner.auth)
        .send({ permissionIds: await permissionIds(ctx.prisma, ['appointments:read', 'appointments:write']) })
        .expect(200);

      const url = `${base()}/appointments/${appointment.id}`;
      await ctx.http().patch(url).set(owner.auth).send({ notes: 'observação nova' }).expect(200);
      await ctx.http().patch(url).set(owner.auth).send({ status: 'confirmed' }).expect(200);
      // Reenviar o mesmo profissional não é troca.
      await ctx.http().patch(url).set(owner.auth).send({ professionalId: former.id, notes: 'de novo' }).expect(200);

      const toReception = await ctx.http().patch(url).set(owner.auth).send({ professionalId: reception.id }).expect(400);
      expect(toReception.body.message).toBe('Este usuário não atende pacientes');
      // Para quem atende, a troca funciona.
      await ctx.http().patch(url).set(owner.auth).send({ professionalId: doctor.id }).expect(200);
    });
  });

  describe('duração própria (PATCH /users/me/appointment-settings)', () => {
    const settings = (as: Pick<TestUser, 'auth'>) =>
      ctx
        .http()
        .patch(`${base()}/users/me/appointment-settings`)
        .set(as.auth)
        .send({ defaultAppointmentDurationMinutes: 40 });

    it('sem attend → 403; com attend → 200', async () => {
      await settings(reception).expect(403);
      const res = await settings(doctor).expect(200);
      expect(res.body.defaultAppointmentDurationMinutes).toBe(40);
    });
  });

  describe('attendsPatients em GET /users', () => {
    it('lista e detalhe dizem quem atende, sem expor o papel', async () => {
      const list = await ctx.http().get(`${base()}/users`).query({ pageSize: 100 }).set(owner.auth).expect(200);
      const byId = new Map(list.body.data.map((u: { id: string; attendsPatients: boolean }) => [u.id, u]));
      expect(byId.get(owner.id)).toMatchObject({ attendsPatients: true });
      expect(byId.get(doctor.id)).toMatchObject({ attendsPatients: true });
      expect(byId.get(reception.id)).toMatchObject({ attendsPatients: false });
      expect(byId.get(doctor.id)).not.toHaveProperty('role');
      expect(byId.get(doctor.id)).not.toHaveProperty('passwordHash');

      const one = await ctx.http().get(`${base()}/users/${reception.id}`).set(owner.auth).expect(200);
      expect(one.body.attendsPatients).toBe(false);
      expect(one.body).not.toHaveProperty('role');
    });

    it('isolamento: usuário de outra clínica é 404', async () => {
      await ctx.http().get(`${base()}/users/${other.id}`).set(owner.auth).expect(404);
    });
  });

  // Roda o SQL da migration numa transação que é desfeita no fim: os outros arquivos de teste,
  // em paralelo, não enxergam as concessões feitas aqui.
  describe('migration appointments_attend_permission', () => {
    it('concede attend ao Admin do cadastro e a quem já foi profissional; a recepção fica sem', async () => {
      const roleIdOf = async (userId: string) =>
        (await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { roleId: true } })).roleId;
      const medico = await createUser(ctx.http, owner, 'medico-migracao', {
        roleId: await createRole('Medico migracao', ['appointments:read', 'appointments:write', 'appointments:attend']),
      });
      await schedule(owner, medico.id, '2031-06-04T13:00:00.000Z').expect(201);
      await schedule(owner, owner.id, '2031-06-04T15:00:00.000Z').expect(201);
      const roles = {
        admin: owner.roleId,
        medico: await roleIdOf(medico.id),
        recepcao: await roleIdOf(reception.id),
      };

      const dir = readdirSync('prisma/migrations').find((name) => name.endsWith('_appointments_attend_permission'))!;
      const statements = readFileSync(join('prisma/migrations', dir, 'migration.sql'), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
      const [attendId] = await permissionIds(ctx.prisma, ['appointments:attend']);
      const ROLLBACK = new Error('rollback');

      const granted = await ctx.prisma
        .$transaction(async (tx) => {
          // Volta ao estado de antes da permissão existir, só nos papéis desta clínica.
          await tx.rolePermission.deleteMany({
            where: { permissionId: attendId, roleId: { in: Object.values(roles) } },
          });
          for (const statement of statements) {
            await tx.$executeRawUnsafe(statement);
          }
          const rows = await tx.rolePermission.findMany({
            where: { permissionId: attendId, roleId: { in: Object.values(roles) } },
            select: { roleId: true },
          });
          throw Object.assign(ROLLBACK, { rows });
        })
        .catch((error: Error & { rows?: { roleId: string }[] }) => {
          if (error !== ROLLBACK) {
            throw error;
          }
          return new Set(error.rows!.map((row) => row.roleId));
        });

      expect(granted.has(roles.admin)).toBe(true);
      expect(granted.has(roles.medico)).toBe(true);
      expect(granted.has(roles.recepcao)).toBe(false);
    });
  });
});
