import { randomUUID } from 'node:crypto';
import {
  createPatient,
  cleanupTenants,
  createAnamnesisTemplate,
  createTestApp,
  createUser,
  permissionIds,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';

// Roda contra o Postgres do .env (docker compose up -d + migrate + seed).
describe('Formulários de anamnese (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  let b: TestTenant;

  const url = (t: TestTenant, suffix = '') => `/tenants/${t.tenantId}/anamnesis-templates${suffix}`;
  const textField = (key: string, extra: Record<string, unknown> = {}) => ({
    key,
    label: key,
    type: 'text',
    required: false,
    ...extra,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'at-a');
    b = await signupTenant(ctx.http, 'at-b');
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, b?.tenantId]);
    await ctx.app.close();
  });

  describe('CRUD', () => {
    it('cria com múltiplos tipos de campo e devolve como cadastrado', async () => {
      const fields = [
        { key: 'queixa', label: 'Queixa principal', type: 'textarea', required: true },
        { key: 'idade', label: 'Idade', type: 'number', required: false },
        { key: 'fumante', label: 'Fumante?', type: 'boolean', required: false },
        { key: 'inicio', label: 'Início dos sintomas', type: 'date', required: false },
        {
          key: 'tipo_sanguineo',
          label: 'Tipo sanguíneo',
          type: 'select',
          required: false,
          options: ['A', 'B', 'AB', 'O'],
        },
        {
          key: 'alergias',
          label: 'Alergias',
          type: 'multiselect',
          required: false,
          options: ['dipirona', 'penicilina'],
        },
      ];

      const res = await ctx
        .http()
        .post(url(a))
        .set(a.auth)
        .send({ name: `Ficha completa ${uniq()}`, fields })
        .expect(201);

      expect(res.body).toMatchObject({ tenantId: a.tenantId, fields });
    });

    it('lista em ordem alfabética e busca uma só', async () => {
      const tag = uniq();
      await ctx.http().post(url(a)).set(a.auth).send({ name: `${tag} Zzz`, fields: [textField('x')] }).expect(201);
      const first = await ctx
        .http()
        .post(url(a))
        .set(a.auth)
        .send({ name: `${tag} Aaa`, fields: [textField('y')] })
        .expect(201);

      const list = await ctx.http().get(url(a)).set(a.auth).expect(200);
      const named = (list.body as { name: string }[]).filter((t) => t.name.startsWith(tag));
      expect(named.map((t) => t.name)).toEqual([`${tag} Aaa`, `${tag} Zzz`]);

      const found = await ctx.http().get(url(a, `/${first.body.id}`)).set(a.auth).expect(200);
      expect(found.body.name).toBe(`${tag} Aaa`);
    });

    it('atualiza nome e campos parcialmente', async () => {
      const template = await createAnamnesisTemplate(ctx.http, a, [textField('a')]);

      const renamed = await ctx
        .http()
        .patch(url(a, `/${template.id}`))
        .set(a.auth)
        .send({ name: `Renomeada ${uniq()}` })
        .expect(200);
      expect(renamed.body.fields).toEqual(template.fields);

      const refielded = await ctx
        .http()
        .patch(url(a, `/${template.id}`))
        .set(a.auth)
        .send({ fields: [textField('b'), textField('c')] })
        .expect(200);
      expect(refielded.body.fields.map((f: { key: string }) => f.key)).toEqual(['b', 'c']);
    });

    it('404 para formulário inexistente ou de outro tenant', async () => {
      const foreign = await createAnamnesisTemplate(ctx.http, b);

      await ctx.http().get(url(a, `/${randomUUID()}`)).set(a.auth).expect(404);
      await ctx.http().get(url(a, `/${foreign.id}`)).set(a.auth).expect(404);
      await ctx.http().patch(url(a, `/${foreign.id}`)).set(a.auth).send({ name: 'x' }).expect(404);
      await ctx.http().delete(url(a, `/${foreign.id}`)).set(a.auth).expect(404);
    });

    it('apaga formulário sem uso; um em uso dá 409 (não 500)', async () => {
      const free = await createAnamnesisTemplate(ctx.http, a);
      await ctx.http().delete(url(a, `/${free.id}`)).set(a.auth).expect(200);
      await ctx.http().get(url(a, `/${free.id}`)).set(a.auth).expect(404);

      const inUse = await createAnamnesisTemplate(ctx.http, a);
      const patient = await createPatient(ctx.http, a);
      await ctx
        .http()
        .post(`/tenants/${a.tenantId}/patients/${patient.id}/anamnesis-records`)
        .set(a.auth)
        .send({ templateId: inUse.id, answers: {} })
        .expect(201);

      await ctx.http().delete(url(a, `/${inUse.id}`)).set(a.auth).expect(409);
      await ctx.http().get(url(a, `/${inUse.id}`)).set(a.auth).expect(200);
    });

    it('nome repetido no mesmo tenant dá 409; em tenants diferentes é permitido', async () => {
      const name = `Duplicada ${uniq()}`;
      await ctx.http().post(url(a)).set(a.auth).send({ name, fields: [textField('x')] }).expect(201);

      await ctx.http().post(url(a)).set(a.auth).send({ name, fields: [textField('y')] }).expect(409);
      await ctx.http().post(url(b)).set(b.auth).send({ name, fields: [textField('z')] }).expect(201);
    });
  });

  describe('validação dos campos do formulário', () => {
    it('recusa select/multiselect sem opções', async () => {
      const res = await ctx
        .http()
        .post(url(a))
        .set(a.auth)
        .send({ name: `Sem opcoes ${uniq()}`, fields: [{ key: 'x', label: 'X', type: 'select', required: false }] })
        .expect(400);
      expect(res.body.message.join(' ')).toContain('x');
    });

    it('recusa opções em campo que não é select/multiselect', async () => {
      await ctx
        .http()
        .post(url(a))
        .set(a.auth)
        .send({
          name: `Opcoes indevidas ${uniq()}`,
          fields: [{ key: 'x', label: 'X', type: 'text', required: false, options: ['a'] }],
        })
        .expect(400);
    });

    it('recusa chave (key) repetida entre campos', async () => {
      await ctx
        .http()
        .post(url(a))
        .set(a.auth)
        .send({ name: `Chave repetida ${uniq()}`, fields: [textField('x'), textField('x')] })
        .expect(400);
    });

    it('recusa key fora do padrão (maiúscula, espaço, começar com número)', async () => {
      for (const key of ['Nome', 'com espaco', '1campo', 'ç', '']) {
        await ctx
          .http()
          .post(url(a))
          .set(a.auth)
          .send({ name: `Key invalida ${uniq()}`, fields: [textField(key)] })
          .expect(400);
      }
    });

    it('recusa tipo de campo desconhecido, lista vazia de campos e nome ausente', async () => {
      await ctx
        .http()
        .post(url(a))
        .set(a.auth)
        .send({ name: `Tipo invalido ${uniq()}`, fields: [{ key: 'x', label: 'X', type: 'arquivo', required: false }] })
        .expect(400);
      await ctx.http().post(url(a)).set(a.auth).send({ name: `Vazio ${uniq()}`, fields: [] }).expect(400);
      await ctx.http().post(url(a)).set(a.auth).send({ fields: [textField('x')] }).expect(400);
    });

    it('a mesma validação vale ao editar (PATCH)', async () => {
      const template = await createAnamnesisTemplate(ctx.http, a, [textField('x')]);

      await ctx
        .http()
        .patch(url(a, `/${template.id}`))
        .set(a.auth)
        .send({ fields: [{ key: 'y', label: 'Y', type: 'select', required: false }] })
        .expect(400);
    });
  });

  describe('permissões', () => {
    let reader: Awaited<ReturnType<typeof createUser>>;

    beforeAll(async () => {
      const [readPatients] = await permissionIds(ctx.prisma, ['patients:read']);
      const role = await ctx
        .http()
        .post(`/tenants/${a.tenantId}/roles`)
        .set(a.auth)
        .send({ name: `Leitura ${uniq()}`, permissionIds: [readPatients] })
        .expect(201);
      reader = await createUser(ctx.http, a, 'leitor-form', { roleId: role.body.id });
    });

    it('patients:read basta para listar e ler, mas não para gerenciar', async () => {
      const template = await createAnamnesisTemplate(ctx.http, a);

      await ctx.http().get(url(a)).set(reader.auth).expect(200);
      await ctx.http().get(url(a, `/${template.id}`)).set(reader.auth).expect(200);
      await ctx.http().post(url(a)).set(reader.auth).send({ name: 'x', fields: [textField('x')] }).expect(403);
      await ctx.http().patch(url(a, `/${template.id}`)).set(reader.auth).send({ name: 'y' }).expect(403);
      await ctx.http().delete(url(a, `/${template.id}`)).set(reader.auth).expect(403);
    });

    it('sem token é 401; token de outro tenant na URL é 403', async () => {
      await ctx.http().get(url(a)).expect(401);
      await ctx.http().get(url(a)).set(b.auth).expect(403);
    });
  });

  describe('preencher anamnese com o template (integração com pacientes)', () => {
    it('valida answers contra os campos do template ao registrar', async () => {
      const template = await createAnamnesisTemplate(ctx.http, a, [
        { key: 'queixa', label: 'Queixa', type: 'textarea', required: true },
        { key: 'idade', label: 'Idade', type: 'number', required: false },
      ]);
      const patient = await createPatient(ctx.http, a);
      const recordsUrl = `/tenants/${a.tenantId}/patients/${patient.id}/anamnesis-records`;

      // Falta o obrigatório.
      await ctx.http().post(recordsUrl).set(a.auth).send({ templateId: template.id, answers: {} }).expect(400);
      // Tipo errado.
      await ctx
        .http()
        .post(recordsUrl)
        .set(a.auth)
        .send({ templateId: template.id, answers: { queixa: 'ok', idade: 'não é número' } })
        .expect(400);
      // Válido.
      const ok = await ctx
        .http()
        .post(recordsUrl)
        .set(a.auth)
        .send({ templateId: template.id, answers: { queixa: 'ok', idade: 30 } })
        .expect(201);
      expect(ok.body.template).toMatchObject({ id: template.id, name: template.name });
    });
  });
});
