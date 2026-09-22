import { randomUUID } from 'node:crypto';
import {
  cleanupTenants,
  createPatient,
  createTestApp,
  createUser,
  permissionIds,
  signupTenant,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Pacientes e anamnese (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;

  const patientsUrl = (t: TestTenant) => `/tenants/${t.tenantId}/patients`;

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'pa');
    b = await signupTenant(ctx.http, 'pb');
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId]);
    await ctx.app.close();
  });

  describe('CRUD', () => {
    it('cria e busca um paciente com todos os campos', async () => {
      const res = await ctx
        .http()
        .post(patientsUrl(a))
        .set(a.auth)
        .send({
          fullName: 'Maria da Silva',
          cpf: '111.111.111-11',
          birthDate: '1990-05-17',
          phone: '(11) 91234-5678',
          email: 'maria@exemplo.com',
          address: { rua: 'Rua A', numero: 10, cidade: 'São Paulo' },
          notes: 'Prefere atendimento à tarde',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        tenantId: a.tenantId,
        fullName: 'Maria da Silva',
        cpf: '111.111.111-11',
        address: { rua: 'Rua A', numero: 10, cidade: 'São Paulo' },
        deletedAt: null,
      });
      expect(res.body.birthDate).toBe('1990-05-17T00:00:00.000Z');

      const found = await ctx.http().get(`${patientsUrl(a)}/${res.body.id}`).set(a.auth).expect(200);
      expect(found.body.fullName).toBe('Maria da Silva');
    });

    it('lista em ordem alfabética', async () => {
      const zeca = await createPatient(ctx.http, a, { fullName: 'Zzz Zeca' });
      const ana = await createPatient(ctx.http, a, { fullName: 'Aaa Ana' });

      const res = await ctx.http().get(patientsUrl(a)).set(a.auth).expect(200);
      const ids = (res.body as { id: string }[]).map((p) => p.id);
      expect(ids.indexOf(ana.id)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(ana.id)).toBeLessThan(ids.indexOf(zeca.id));
    });

    it('atualiza parcialmente e preserva o resto', async () => {
      const patient = await createPatient(ctx.http, a, { fullName: 'Antes', phone: '111' });

      const res = await ctx
        .http()
        .patch(`${patientsUrl(a)}/${patient.id}`)
        .set(a.auth)
        .send({ fullName: 'Depois', birthDate: '2001-02-03' })
        .expect(200);

      expect(res.body).toMatchObject({ fullName: 'Depois', phone: '111' });
      expect(res.body.birthDate).toBe('2001-02-03T00:00:00.000Z');
    });

    it('404 para paciente inexistente', async () => {
      await ctx.http().get(`${patientsUrl(a)}/${randomUUID()}`).set(a.auth).expect(404);
    });

    it('valida o body (campo extra, email inválido, nome ausente)', async () => {
      await ctx.http().post(patientsUrl(a)).set(a.auth).send({ fullName: 'X', foo: 1 }).expect(400);
      await ctx
        .http()
        .post(patientsUrl(a))
        .set(a.auth)
        .send({ fullName: 'X', email: 'naoemail' })
        .expect(400);
      await ctx.http().post(patientsUrl(a)).set(a.auth).send({}).expect(400);
    });
  });

  describe('exclusão (soft delete)', () => {
    it('some das leituras, mas o registro continua no banco', async () => {
      const patient = await createPatient(ctx.http, a);

      await ctx.http().delete(`${patientsUrl(a)}/${patient.id}`).set(a.auth).expect(200);

      await ctx.http().get(`${patientsUrl(a)}/${patient.id}`).set(a.auth).expect(404);
      const list = await ctx.http().get(patientsUrl(a)).set(a.auth).expect(200);
      expect((list.body as { id: string }[]).some((p) => p.id === patient.id)).toBe(false);

      const row = await ctx.prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
      expect(row.deletedAt).not.toBeNull();
    });

    it('paciente removido não pode ser editado nem excluído de novo', async () => {
      const patient = await createPatient(ctx.http, a);
      await ctx.http().delete(`${patientsUrl(a)}/${patient.id}`).set(a.auth).expect(200);

      await ctx
        .http()
        .patch(`${patientsUrl(a)}/${patient.id}`)
        .set(a.auth)
        .send({ fullName: 'Ressuscitado' })
        .expect(404);
      await ctx.http().delete(`${patientsUrl(a)}/${patient.id}`).set(a.auth).expect(404);
    });
  });

  describe('CPF único por tenant', () => {
    it('recusa CPF repetido no mesmo tenant com 409 (não 500)', async () => {
      await createPatient(ctx.http, a, { cpf: '222.222.222-22' });

      const res = await ctx
        .http()
        .post(patientsUrl(a))
        .set(a.auth)
        .send({ fullName: 'Outro', cpf: '222.222.222-22' })
        .expect(409);
      expect(res.body.message).toMatch(/cpf/i);
    });

    it('recusa trocar o CPF para um que já existe com 409', async () => {
      await createPatient(ctx.http, a, { cpf: '333.333.333-33' });
      const other = await createPatient(ctx.http, a, { cpf: '444.444.444-44' });

      await ctx
        .http()
        .patch(`${patientsUrl(a)}/${other.id}`)
        .set(a.auth)
        .send({ cpf: '333.333.333-33' })
        .expect(409);
    });

    it('o mesmo CPF pode existir em tenants diferentes', async () => {
      await createPatient(ctx.http, a, { cpf: '555.555.555-55' });
      await createPatient(ctx.http, b, { cpf: '555.555.555-55' });
    });

    it('vários pacientes sem CPF são permitidos', async () => {
      await createPatient(ctx.http, a);
      await createPatient(ctx.http, a);
    });

    it('CPF de paciente removido continua reservado: 409 apontando o paciente a restaurar', async () => {
      const patient = await createPatient(ctx.http, a, { cpf: '666.666.666-66' });
      await ctx.http().delete(`${patientsUrl(a)}/${patient.id}`).set(a.auth).expect(200);

      const res = await ctx
        .http()
        .post(patientsUrl(a))
        .set(a.auth)
        .send({ fullName: 'Recadastro', cpf: '666.666.666-66' })
        .expect(409);
      expect(res.body.message).toMatch(/restaure/i);
      expect(res.body.removedPatientId).toBe(patient.id);
    });

    it('trocar o CPF para o de um paciente removido também dá 409', async () => {
      const removed = await createPatient(ctx.http, a, { cpf: '777.777.777-77' });
      await ctx.http().delete(`${patientsUrl(a)}/${removed.id}`).set(a.auth).expect(200);
      const other = await createPatient(ctx.http, a);

      const res = await ctx
        .http()
        .patch(`${patientsUrl(a)}/${other.id}`)
        .set(a.auth)
        .send({ cpf: '777.777.777-77' })
        .expect(409);
      expect(res.body.removedPatientId).toBe(removed.id);
    });

    it('reenviar o próprio CPF ao editar o paciente não conflita consigo mesmo', async () => {
      const patient = await createPatient(ctx.http, a, { cpf: '888.888.888-88' });
      await ctx
        .http()
        .patch(`${patientsUrl(a)}/${patient.id}`)
        .set(a.auth)
        .send({ cpf: '888.888.888-88', fullName: 'Mesmo CPF' })
        .expect(200);
    });
  });

  describe('restauração de pacientes removidos', () => {
    const removedUrl = (t: TestTenant) => `${patientsUrl(t)}/removed`;

    it('lista só os removidos, do mais recente para o mais antigo', async () => {
      const first = await createPatient(ctx.http, a);
      const second = await createPatient(ctx.http, a);
      const active = await createPatient(ctx.http, a);
      await ctx.http().delete(`${patientsUrl(a)}/${first.id}`).set(a.auth).expect(200);
      await ctx.http().delete(`${patientsUrl(a)}/${second.id}`).set(a.auth).expect(200);

      const res = await ctx.http().get(removedUrl(a)).set(a.auth).expect(200);
      const ids = (res.body as { id: string }[]).map((p) => p.id);

      expect(ids).toContain(first.id);
      expect(ids).not.toContain(active.id);
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    });

    it('restaura o paciente com dados e anamnese intactos, e o CPF continua dele', async () => {
      const patient = await createPatient(ctx.http, a, {
        fullName: 'Volta Ao Cadastro',
        cpf: '999.999.999-99',
      });
      const anamnesisUrl = `${patientsUrl(a)}/${patient.id}/anamnesis-records`;
      await ctx.http().post(anamnesisUrl).set(a.auth).send({ answers: { queixa: 'x' } }).expect(201);
      await ctx.http().delete(`${patientsUrl(a)}/${patient.id}`).set(a.auth).expect(200);
      await ctx.http().get(`${patientsUrl(a)}/${patient.id}`).set(a.auth).expect(404);

      const restored = await ctx
        .http()
        .post(`${patientsUrl(a)}/${patient.id}/restore`)
        .set(a.auth)
        .expect(201);
      expect(restored.body).toMatchObject({ id: patient.id, fullName: 'Volta Ao Cadastro', deletedAt: null });

      await ctx.http().get(`${patientsUrl(a)}/${patient.id}`).set(a.auth).expect(200);
      const list = await ctx.http().get(patientsUrl(a)).set(a.auth).expect(200);
      expect((list.body as { id: string }[]).some((p) => p.id === patient.id)).toBe(true);
      const removed = await ctx.http().get(removedUrl(a)).set(a.auth).expect(200);
      expect((removed.body as { id: string }[]).some((p) => p.id === patient.id)).toBe(false);

      const records = await ctx.http().get(anamnesisUrl).set(a.auth).expect(200);
      expect(records.body).toHaveLength(1);

      // Já ativo de novo: o CPF é dele, então recadastrar dá o 409 comum (sem "removido").
      const dup = await ctx
        .http()
        .post(patientsUrl(a))
        .set(a.auth)
        .send({ fullName: 'Outro', cpf: '999.999.999-99' })
        .expect(409);
      expect(dup.body.removedPatientId).toBeUndefined();
    });

    it('só restaura paciente removido do próprio tenant', async () => {
      const active = await createPatient(ctx.http, a);
      const removedOfA = await createPatient(ctx.http, a);
      await ctx.http().delete(`${patientsUrl(a)}/${removedOfA.id}`).set(a.auth).expect(200);

      // Ativo (nada a restaurar) e inexistente.
      await ctx.http().post(`${patientsUrl(a)}/${active.id}/restore`).set(a.auth).expect(404);
      await ctx.http().post(`${patientsUrl(a)}/${randomUUID()}/restore`).set(a.auth).expect(404);

      // Outro tenant: pela URL dele é 404, pela URL do tenant A é 403; e continua removido.
      await ctx.http().post(`${patientsUrl(b)}/${removedOfA.id}/restore`).set(b.auth).expect(404);
      await ctx.http().post(`${patientsUrl(a)}/${removedOfA.id}/restore`).set(b.auth).expect(403);
      await ctx.http().get(removedUrl(a)).set(b.auth).expect(403);
      const row = await ctx.prisma.patient.findUniqueOrThrow({ where: { id: removedOfA.id } });
      expect(row.deletedAt).not.toBeNull();

      const bList = await ctx.http().get(removedUrl(b)).set(b.auth).expect(200);
      expect((bList.body as { id: string }[]).some((p) => p.id === removedOfA.id)).toBe(false);
    });

    it('exige patients:write (quem só lê não vê removidos nem restaura)', async () => {
      const [readOnly] = await permissionIds(ctx.prisma, ['patients:read']);
      const role = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(a.auth)
        .send({ name: `Leitura ${Date.now()}`, permissionIds: [readOnly] })
        .expect(201);
      const reader = await createUser(ctx.http, a, 'leitor-pac', { roleId: role.body.id });
      const removed = await createPatient(ctx.http, a);
      await ctx.http().delete(`${patientsUrl(a)}/${removed.id}`).set(a.auth).expect(200);

      await ctx.http().get(patientsUrl(a)).set(reader.auth).expect(200);
      await ctx.http().get(removedUrl(a)).set(reader.auth).expect(403);
      await ctx.http().post(`${patientsUrl(a)}/${removed.id}/restore`).set(reader.auth).expect(403);
    });
  });

  describe('isolamento entre tenants', () => {
    it('não acessa a URL de outro tenant (403)', async () => {
      const patient = await createPatient(ctx.http, a);
      await ctx.http().get(`${patientsUrl(a)}/${patient.id}`).set(b.auth).expect(403);
      await ctx.http().get(patientsUrl(a)).set(b.auth).expect(403);
    });

    it('não alcança paciente de outro tenant usando a própria URL (404)', async () => {
      const patient = await createPatient(ctx.http, a, { fullName: 'Paciente do A' });

      await ctx.http().get(`${patientsUrl(b)}/${patient.id}`).set(b.auth).expect(404);
      await ctx
        .http()
        .patch(`${patientsUrl(b)}/${patient.id}`)
        .set(b.auth)
        .send({ fullName: 'Sequestrado' })
        .expect(404);
      await ctx.http().delete(`${patientsUrl(b)}/${patient.id}`).set(b.auth).expect(404);

      const row = await ctx.prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
      expect(row).toMatchObject({ fullName: 'Paciente do A', deletedAt: null });
    });

    it('a listagem de um tenant nunca traz pacientes de outro', async () => {
      const patient = await createPatient(ctx.http, a);
      const res = await ctx.http().get(patientsUrl(b)).set(b.auth).expect(200);
      expect((res.body as { id: string }[]).some((p) => p.id === patient.id)).toBe(false);
    });
  });

  describe('anamnese', () => {
    it('registra fichas com o autor e lista da mais recente para a mais antiga', async () => {
      const patient = await createPatient(ctx.http, a);
      const url = `${patientsUrl(a)}/${patient.id}/anamnesis-records`;

      const first = await ctx
        .http()
        .post(url)
        .set(a.auth)
        .send({ answers: { queixa: 'dor de cabeça', alergias: ['dipirona'], fumante: false } })
        .expect(201);
      expect(first.body).toMatchObject({
        tenantId: a.tenantId,
        patientId: patient.id,
        filledByUserId: a.id,
        answers: { queixa: 'dor de cabeça', alergias: ['dipirona'], fumante: false },
      });

      await ctx.http().post(url).set(a.auth).send({ answers: { queixa: 'retorno' } }).expect(201);

      const list = await ctx.http().get(url).set(a.auth).expect(200);
      expect((list.body as { answers: { queixa: string } }[]).map((r) => r.answers.queixa)).toEqual([
        'retorno',
        'dor de cabeça',
      ]);
    });

    it('exige answers como objeto', async () => {
      const patient = await createPatient(ctx.http, a);
      const url = `${patientsUrl(a)}/${patient.id}/anamnesis-records`;

      await ctx.http().post(url).set(a.auth).send({}).expect(400);
      await ctx.http().post(url).set(a.auth).send({ answers: 'texto' }).expect(400);
      await ctx.http().post(url).set(a.auth).send({ answers: ['a', 'b'] }).expect(400);
    });

    it('não registra nem lista ficha de paciente inexistente, removido ou de outro tenant', async () => {
      const removed = await createPatient(ctx.http, a);
      await ctx.http().delete(`${patientsUrl(a)}/${removed.id}`).set(a.auth).expect(200);
      const foreign = await createPatient(ctx.http, a);

      for (const id of [randomUUID(), removed.id]) {
        const url = `${patientsUrl(a)}/${id}/anamnesis-records`;
        await ctx.http().post(url).set(a.auth).send({ answers: { x: 1 } }).expect(404);
        await ctx.http().get(url).set(a.auth).expect(404);
      }

      // Paciente do A acessado pela URL do B: 404, sem vazar nem gravar ficha.
      const crossUrl = `${patientsUrl(b)}/${foreign.id}/anamnesis-records`;
      await ctx.http().post(crossUrl).set(b.auth).send({ answers: { x: 1 } }).expect(404);
      await ctx.http().get(crossUrl).set(b.auth).expect(404);
      expect(await ctx.prisma.anamnesisRecord.count({ where: { patientId: foreign.id } })).toBe(0);
    });

    it('as fichas somem da leitura junto com o paciente removido, mas ficam no banco', async () => {
      const patient = await createPatient(ctx.http, a);
      const url = `${patientsUrl(a)}/${patient.id}/anamnesis-records`;
      await ctx.http().post(url).set(a.auth).send({ answers: { x: 1 } }).expect(201);

      await ctx.http().delete(`${patientsUrl(a)}/${patient.id}`).set(a.auth).expect(200);

      await ctx.http().get(url).set(a.auth).expect(404);
      expect(await ctx.prisma.anamnesisRecord.count({ where: { patientId: patient.id } })).toBe(1);
    });
  });
});
