import {
  LEGAL,
  PASSWORD,
  cleanupTenants,
  createAnamnesisTemplate,
  createPatient,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
  createTestApp,
} from './helpers/e2e.js';

// Validação do cadastro de clínica (que vai para a landing, fora do app) e o formato dos erros de
// validação em toda a API: mensagens em português e `errors` estruturado por campo.
describe('Validação: cadastro de clínica, texto obrigatório e mensagens (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;
  const created: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'validacao');
  });

  afterEach(() => {
    delete process.env.APP_BASE_DOMAIN;
    delete process.env.RESERVED_SUBDOMAINS;
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId, ...created]);
    await ctx.app.close();
  });

  function signupBody(overrides: Record<string, unknown> = {}, owner: Record<string, unknown> = {}) {
    const suffix = uniq();
    return {
      name: `Clinica Validacao ${suffix}`,
      subdomain: `validacao-${suffix}`,
      owner: { name: 'Dona', email: `dona-validacao-${suffix}@teste.com`, password: PASSWORD, ...owner },
      legalAcceptance: LEGAL,
      ...overrides,
    };
  }

  const signup = (body: Record<string, unknown>) => ctx.http().post('/tenants').send(body);

  describe('textos obrigatórios', () => {
    it.each(['', '   '])('nome da clínica %j → 400', async (name) => {
      const res = await signup(signupBody({ name })).expect(400);
      expect(res.body.errors).toEqual([
        { field: 'name', code: 'required', message: 'Nome da clínica é obrigatório' },
      ]);
    });

    it.each(['', '   '])('nome do responsável %j → 400', async (name) => {
      const res = await signup(signupBody({}, { name })).expect(400);
      expect(res.body.errors).toEqual([
        { field: 'owner.name', code: 'required', message: 'Nome do responsável é obrigatório' },
      ]);
    });

    it('PATCH /tenants/:id com nome vazio → 400', async () => {
      await ctx.http().patch(`/tenants/${a.tenantId}`).set(a.auth).send({ name: '  ' }).expect(400);
    });

    it('os nomes são gravados sem espaços nas pontas', async () => {
      const body = signupBody({ name: '  Clínica Espaçada  ' }, { name: '  Dona Espaçada ' });
      const res = await signup(body).expect(201);
      created.push(res.body.tenant.id);
      expect(res.body.tenant.name).toBe('Clínica Espaçada');
      expect(res.body.owner.name).toBe('Dona Espaçada');
    });

    it('vale nas outras rotas: paciente, usuário, papel, formulário, cobrança e nome fantasia', async () => {
      const base = `/tenants/${a.tenantId}`;
      const patient = await createPatient(ctx.http, a);
      const cases: [string, string, Record<string, unknown>, string][] = [
        ['post', `${base}/patients`, { fullName: ' ' }, 'fullName'],
        ['patch', `${base}/patients/${patient.id}`, { fullName: '' }, 'fullName'],
        ['post', `${base}/users`, { name: ' ', email: `u-${uniq()}@teste.com`, roleId: a.roleId }, 'name'],
        ['post', `${base}/roles`, { name: '' }, 'name'],
        ['post', `${base}/anamnesis-templates`, { name: ' ', fields: [{ key: 'a', label: 'A', type: 'text', required: false }] }, 'name'],
        ['post', `${base}/anamnesis-templates`, { name: 'Ficha', fields: [{ key: 'a', label: ' ', type: 'text', required: false }] }, 'fields.0.label'],
        ['post', `${base}/charges`, { patientId: patient.id, description: '  ', amountCents: 100, dueDate: '2026-12-01' }, 'description'],
        ['patch', `${base}/branding`, { tradeName: '   ' }, 'tradeName'],
      ];
      for (const [method, url, body, field] of cases) {
        const res = await ctx.http()[method as 'post' | 'patch'](url).set(a.auth).send(body).expect(400);
        expect(res.body.errors, `${method} ${url}`).toEqual([expect.objectContaining({ field, code: 'required' })]);
      }
      // Limpar o nome fantasia continua sendo com null.
      await ctx.http().patch(`${base}/branding`).set(a.auth).send({ tradeName: null }).expect(200);
    });
  });

  describe('mensagens de validação em português, com o campo', () => {
    it('cada campo errado vira uma mensagem e uma entrada em `errors`', async () => {
      const res = await signup(
        signupBody({}, { email: 'nao-e-email', password: 'curta' }),
      ).expect(400);
      expect(res.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: ['Email do responsável inválido', 'Senha do responsável deve ter pelo menos 8 caracteres'],
        errors: [
          { field: 'owner.email', code: 'isEmail', message: 'Email do responsável inválido' },
          {
            field: 'owner.password',
            code: 'minLength',
            message: 'Senha do responsável deve ter pelo menos 8 caracteres',
          },
        ],
      });
    });

    it('campo ausente é `required`; campo extra é `unknownField`', async () => {
      const { owner: _owner, ...withoutOwner } = signupBody({ extra: 1 });
      const res = await signup(withoutOwner).expect(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          { field: 'owner', code: 'required', message: 'Responsável é obrigatório' },
          { field: 'extra', code: 'unknownField', message: 'O campo "extra" não é permitido' },
        ]),
      );
    });

    it('regra com mensagem própria no DTO mantém a mensagem (formato do subdomínio)', async () => {
      const res = await signup(signupBody({ subdomain: 'Clinica' })).expect(400);
      expect(res.body.errors).toEqual([
        {
          field: 'subdomain',
          code: 'matches',
          message: 'O subdomínio deve ter só letras minúsculas, números e hífen, sem hífen no começo nem no fim',
        },
      ]);
    });

    it('vale para query e para listas: enum, número e item de lista', async () => {
      const page = await ctx
        .http()
        .get(`/tenants/${a.tenantId}/patients?pageSize=500`)
        .set(a.auth)
        .expect(400);
      expect(page.body.errors).toEqual([
        { field: 'pageSize', code: 'max', message: 'Tamanho da página deve ser no máximo 100' },
      ]);

      const status = await ctx
        .http()
        .get(`/tenants/${a.tenantId}/charges?status=quase`)
        .set(a.auth)
        .expect(400);
      expect(status.body.errors[0]).toEqual({
        field: 'status',
        code: 'isEnum',
        message: 'Status inválido. Valores aceitos: pending, overdue, paid, cancelled',
      });

      const template = await createAnamnesisTemplate(ctx.http, a);
      const options = await ctx
        .http()
        .patch(`/tenants/${a.tenantId}/anamnesis-templates/${template.id}`)
        .set(a.auth)
        .send({ fields: [{ key: 'cor', label: 'Cor', type: 'select', required: false, options: ['x'.repeat(81)] }] })
        .expect(400);
      expect(options.body.errors).toEqual([
        { field: 'fields.0.options', code: 'maxLength', message: 'Lista de opções tem item com mais de 80 caracteres' },
      ]);
    });
  });

  describe('subdomínio', () => {
    it.each(['www', 'api', 'app', 'admin'])('reservado %j → 409 no cadastro', async (subdomain) => {
      const res = await signup(signupBody({ subdomain })).expect(409);
      expect(res.body.message).toBe('Este subdomínio não está disponível');
    });

    it('RESERVED_SUBDOMAINS acrescenta reservados por ambiente', async () => {
      process.env.RESERVED_SUBDOMAINS = 'landing, promo';
      await signup(signupBody({ subdomain: 'promo' })).expect(409);
    });

    it('reservado → 409 também no PATCH; trocar outro campo de uma clínica antiga continua valendo', async () => {
      const res = await ctx.http().patch(`/tenants/${a.tenantId}`).set(a.auth).send({ subdomain: 'admin' }).expect(409);
      expect(res.body.message).toBe('Este subdomínio não está disponível');

      // Clínica criada antes da lista com um endereço hoje reservado.
      process.env.RESERVED_SUBDOMAINS = 'antiga-reservada';
      const old = await ctx.prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
      await ctx.prisma.tenant.update({ where: { id: a.tenantId }, data: { subdomain: 'antiga-reservada' } });
      try {
        await ctx
          .http()
          .patch(`/tenants/${a.tenantId}`)
          .set(a.auth)
          .send({ subdomain: 'antiga-reservada', defaultAppointmentDurationMinutes: 40 })
          .expect(200);
      } finally {
        await ctx.prisma.tenant.update({ where: { id: a.tenantId }, data: { subdomain: old.subdomain } });
      }
    });

    it.each(['-clinica', 'clinica-', '-', 'cli_nica'])('formato inválido %j → 400', async (subdomain) => {
      await signup(signupBody({ subdomain })).expect(400);
    });

    it('formato válido com hífen no meio e de um caractere só', async () => {
      for (const subdomain of [`a-${uniq()}`, uniq().slice(0, 1)]) {
        const res = await signup(signupBody({ subdomain }));
        if (res.status === 201) {
          created.push(res.body.tenant.id);
        } else {
          // Um caractere pode já estar em uso por outra execução; o que não pode é 400.
          expect(res.status).toBe(409);
        }
      }
    });
  });

  describe('domínio próprio', () => {
    it('o domínio base da plataforma ou um subdomínio dele → 409', async () => {
      process.env.APP_BASE_DOMAIN = 'bemtevi.test';
      for (const customDomain of ['bemtevi.test', 'algo.bemtevi.test']) {
        const res = await signup(signupBody({ customDomain })).expect(409);
        expect(res.body.message).toBe('Este domínio não está disponível');
        await ctx.http().patch(`/tenants/${a.tenantId}`).set(a.auth).send({ customDomain }).expect(409);
      }
    });
  });

  describe('senha do responsável', () => {
    it('mais de 200 caracteres → 400', async () => {
      const res = await signup(signupBody({}, { password: 'a'.repeat(201) })).expect(400);
      expect(res.body.errors).toEqual([
        {
          field: 'owner.password',
          code: 'maxLength',
          message: 'Senha do responsável deve ter no máximo 200 caracteres',
        },
      ]);
    });
  });

  it('cadastro válido continua com a mesma resposta 201', async () => {
    const res = await signup(signupBody()).expect(201);
    created.push(res.body.tenant.id);
    expect(Object.keys(res.body).sort()).toEqual(['owner', 'role', 'tenant']);
  });
});
