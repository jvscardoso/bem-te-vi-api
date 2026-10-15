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
import { normalizePhone } from '../src/patients/phone.js';

// Contato do paciente para a comunicação automática (fase 0 do marketing): telefone normalizado
// (E.164) e consentimento para WhatsApp e marketing.
describe('Paciente: telefone normalizado e consentimento (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;
  let reader: TestUser; // só patients:read

  const patientUrl = (id: string, suffix = '', t: TestTenant = a) => `/tenants/${t.tenantId}/patients/${id}${suffix}`;
  const consents = (id: string, body: object, as: Pick<TestUser, 'auth'> = a) =>
    ctx.http().put(patientUrl(id, '/consents')).set(as.auth).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'contato-a');
    b = await signupTenant(ctx.http, 'contato-b');
    const role = await ctx
      .http()
      .post(`/tenants/${a.tenantId}/roles`)
      .set(a.auth)
      .send({ name: `Leitura ${uniq()}`, permissionIds: await permissionIds(ctx.prisma, ['patients:read']) })
      .expect(201);
    reader = await createUser(ctx.http, a, 'leitura-contato', { roleId: role.body.id });
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId]);
    await ctx.app.close();
  });

  describe('telefone normalizado (phoneE164)', () => {
    it('é calculado no cadastro, segue a edição e some quando o telefone é limpo', async () => {
      const patient = await createPatient(ctx.http, a, { phone: '(61) 98888-7777' });
      expect(patient).toMatchObject({ phone: '(61) 98888-7777', phoneE164: '+5561988887777' });

      const edited = await ctx.http().patch(patientUrl(patient.id)).set(a.auth).send({ phone: '+1 415 555 2671' }).expect(200);
      expect(edited.body.phoneE164).toBe('+14155552671');

      const cleared = await ctx.http().patch(patientUrl(patient.id)).set(a.auth).send({ phone: null }).expect(200);
      expect(cleared.body).toMatchObject({ phone: null, phoneE164: null });
    });

    it('telefone que não dá um número reconhecível fica guardado, com phoneE164 null', async () => {
      const patient = await createPatient(ctx.http, a, { phone: 'ramal 2030' });
      expect(patient).toMatchObject({ phone: 'ramal 2030', phoneE164: null });
    });

    it('editar outro campo não mexe no phoneE164; não dá para enviá-lo (a API calcula)', async () => {
      const patient = await createPatient(ctx.http, a, { phone: '61 3344-5566' });
      const edited = await ctx.http().patch(patientUrl(patient.id)).set(a.auth).send({ notes: 'x' }).expect(200);
      expect(edited.body.phoneE164).toBe('+556133445566');
      const res = await ctx.http().patch(patientUrl(patient.id)).set(a.auth).send({ phoneE164: '+5500000000000' }).expect(400);
      expect(res.body.errors[0]).toMatchObject({ field: 'phoneE164', code: 'unknownField' });
    });

    // O SQL da migration preenche os pacientes antigos: tem de dar o mesmo que normalizePhone.
    // Roda numa transação desfeita no fim, só para conferir.
    it('o preenchimento da migration concorda com normalizePhone', async () => {
      const samples = [
        '(61) 98888-7777', '61988887777', '061 98888-7777', '55 61 98888-7777', '+55 (61) 98888-7777',
        '+1 415 555 2671', '(61) 3344-5566', '98888-7777', '1234', '+123', 'ramal 2030', '1234567890123456',
      ];
      const ids: string[] = [];
      for (const phone of samples) {
        ids.push((await createPatient(ctx.http, a, { phone })).id);
      }
      const dir = readdirSync('prisma/migrations').find((name) => name.endsWith('_phase0_timezone_phone_consents'))!;
      const sql = readFileSync(join('prisma/migrations', dir, 'migration.sql'), 'utf8');
      const update = sql.slice(sql.indexOf('UPDATE "patients"')).trim().replace(/;$/, '');
      const ROLLBACK = new Error('rollback');

      const fromSql = await ctx.prisma
        .$transaction(async (tx) => {
          await tx.patient.updateMany({ where: { id: { in: ids } }, data: { phoneE164: null } });
          // Só os pacientes deste teste: os outros arquivos rodam em paralelo.
          await tx.$executeRawUnsafe(`${update} AND p."id" = ANY($1::text[])`, ids);
          const rows = await tx.patient.findMany({ where: { id: { in: ids } }, select: { phone: true, phoneE164: true } });
          throw Object.assign(ROLLBACK, { rows });
        })
        .catch((error: Error & { rows?: { phone: string | null; phoneE164: string | null }[] }) => {
          if (error !== ROLLBACK) {
            throw error;
          }
          return error.rows!;
        });

      expect(fromSql).toHaveLength(samples.length);
      for (const row of fromSql) {
        expect([row.phone, row.phoneE164]).toEqual([row.phone, normalizePhone(row.phone)]);
      }
    });
  });

  describe('consentimento (WhatsApp, marketing)', () => {
    it('o detalhe do paciente traz os dois, "não" quando nunca registrado', async () => {
      const patient = await createPatient(ctx.http, a);
      const res = await ctx.http().get(patientUrl(patient.id)).set(a.auth).expect(200);
      expect(res.body.consents).toEqual({
        whatsapp: { granted: false, updatedAt: null, source: null },
        marketing: { granted: false, updatedAt: null, source: null },
      });
    });

    it('registra (envio parcial), responde o estado atual e o detalhe passa a mostrar', async () => {
      const patient = await createPatient(ctx.http, a);
      const res = await consents(patient.id, { whatsapp: true }).expect(200);
      expect(res.body.whatsapp).toMatchObject({ granted: true, source: 'staff' });
      expect(res.body.marketing).toMatchObject({ granted: false, updatedAt: null });

      await consents(patient.id, { marketing: true }).expect(200);
      const detail = await ctx.http().get(patientUrl(patient.id)).set(a.auth).expect(200);
      expect(detail.body.consents.whatsapp.granted).toBe(true);
      expect(detail.body.consents.marketing.granted).toBe(true);
    });

    it('guarda o histórico (cada mudança é uma linha) e repetir o mesmo valor não grava nada', async () => {
      const patient = await createPatient(ctx.http, a);
      await consents(patient.id, { whatsapp: true }).expect(200);
      await consents(patient.id, { whatsapp: true }).expect(200);
      await consents(patient.id, { whatsapp: false }).expect(200);
      const rows = await ctx.prisma.patientConsent.findMany({
        where: { patientId: patient.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((row) => [row.purpose, row.granted, row.source, row.recordedByUserId])).toEqual([
        ['whatsapp', true, 'staff', a.id],
        ['whatsapp', false, 'staff', a.id],
      ]);
    });

    it('a mudança entra na trilha de auditoria, com de → para; sem mudança, sem registro', async () => {
      const patient = await createPatient(ctx.http, a);
      await consents(patient.id, { whatsapp: true, marketing: false }).expect(200);
      const logs = await ctx.prisma.auditLog.findMany({
        where: { tenantId: a.tenantId, patientId: patient.id, action: 'patient.consent_update' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toEqual({ changes: { whatsapp: { from: false, to: true } } });
    });

    it('corpo sem nenhum consentimento ou com valor que não é booleano → 400', async () => {
      const patient = await createPatient(ctx.http, a);
      const empty = await consents(patient.id, {}).expect(400);
      expect(empty.body.message).toBe('Informe ao menos um consentimento (whatsapp ou marketing)');
      const wrong = await consents(patient.id, { whatsapp: 'sim' }).expect(400);
      expect(wrong.body.errors[0]).toMatchObject({ field: 'whatsapp', code: 'isBoolean' });
    });

    it('exige patients:write; paciente removido ou de outra clínica → 404/403', async () => {
      const patient = await createPatient(ctx.http, a);
      await consents(patient.id, { whatsapp: true }, reader).expect(403);

      await ctx.http().delete(patientUrl(patient.id)).set(a.auth).expect(200);
      await consents(patient.id, { whatsapp: true }).expect(404);

      const other = await createPatient(ctx.http, b);
      await consents(other.id, { whatsapp: true }).expect(404);
      await ctx.http().put(patientUrl(other.id, '/consents', b)).set(a.auth).send({ whatsapp: true }).expect(403);
    });

    it('as exportações levam o histórico de consentimento (LGPD)', async () => {
      const patient = await createPatient(ctx.http, a);
      await consents(patient.id, { whatsapp: true }).expect(200);
      await consents(patient.id, { whatsapp: false, marketing: true }).expect(200);

      const exported = await ctx.http().get(patientUrl(patient.id, '/export')).set(a.auth).expect(200);
      expect(exported.body.consents.map((c: { purpose: string; granted: boolean }) => [c.purpose, c.granted])).toEqual([
        ['whatsapp', true],
        ['whatsapp', false],
        ['marketing', true],
      ]);

      const clinic = await ctx.http().get(`/tenants/${a.tenantId}/export`).set(a.auth).expect(200);
      expect(clinic.body.patientConsents.filter((c: { patientId: string }) => c.patientId === patient.id)).toHaveLength(3);
      expect(clinic.body).toHaveProperty('configs');
    });
  });
});
