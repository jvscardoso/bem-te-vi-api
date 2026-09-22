// Gera a coleção Postman v2.1 (importável também no Insomnia) e o ambiente local.
//   node docs/api/build-collection.mjs
// Saída: docs/api/bem-te-vi.postman_collection.json e bem-te-vi.local.postman_environment.json
//
// A coleção é um roteiro de ponta a ponta: cada pasta usa variáveis gravadas pelas anteriores
// (tenantId, tokens, ids), então rode em ordem — manualmente ou pelo Collection Runner.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

// ---------- helpers ----------

const exec = (...lines) => ({ type: 'text/javascript', exec: lines.flat() });
const status = (code, label = '') =>
  `pm.test('Status ${code}${label ? ` (${label})` : ''}', () => pm.response.to.have.status(${code}));`;
const json = 'const b = pm.response.json();';
const set = (name, expr) => `pm.collectionVariables.set('${name}', ${expr});`;
const check = (label, expr) => `pm.test(${JSON.stringify(label)}, () => pm.expect(${expr}).to.be.true);`;

const bearer = (variable) => ({
  type: 'bearer',
  bearer: [{ key: 'token', value: `{{${variable}}}`, type: 'string' }],
});

// query: [chave, valor, { disabled, description }]
function urlOf(path, query = []) {
  const enabled = query.filter(([, , o]) => !o?.disabled);
  const qs = enabled.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%7B/g, '{').replace(/%7D/g, '}').replace(/%24/g, '$')}`).join('&');
  return {
    raw: `{{baseUrl}}${path}${qs ? `?${qs}` : ''}`,
    host: ['{{baseUrl}}'],
    path: path.split('/').filter(Boolean),
    ...(query.length
      ? {
          query: query.map(([key, value, o]) => ({
            key,
            value,
            ...(o?.disabled ? { disabled: true } : {}),
            ...(o?.description ? { description: o.description } : {}),
          })),
        }
      : {}),
  };
}

// auth: undefined = herda o Bearer {{accessToken}} da coleção; 'none' = sem token; 'gestorToken' etc.
function req(name, method, path, { query, body, auth, description, pre, test } = {}) {
  const item = {
    name,
    request: {
      method,
      header: [],
      url: urlOf(path, query),
      ...(description ? { description } : {}),
      ...(body !== undefined
        ? {
            body: {
              mode: 'raw',
              raw: JSON.stringify(body, null, 2),
              options: { raw: { language: 'json' } },
            },
          }
        : {}),
      ...(auth === 'none' ? { auth: { type: 'noauth' } } : auth ? { auth: bearer(auth) } : {}),
    },
    event: [],
  };
  if (pre) item.event.push({ listen: 'prerequest', script: exec(pre) });
  if (test) item.event.push({ listen: 'test', script: exec(test) });
  return item;
}

const folder = (name, description, item, pre) => ({
  name,
  description,
  item,
  ...(pre ? { event: [{ listen: 'prerequest', script: exec(pre) }] } : {}),
});

// ---------- 00 · Saúde ----------

const saude = folder('00 · Saúde', 'Verifica se a API está no ar.', [
  req('API no ar', 'GET', '/', {
    auth: 'none',
    description: 'Rota pública. Responde 200 se a API subiu.',
    test: [status(200)],
  }),
]);

// ---------- 01 · Autenticação ----------

const autenticacao = folder(
  '01 · Autenticação',
  'Cria a clínica A (tenant + papel Admin + dono) e faz login. **Rode esta pasta primeiro:** ela grava `tenantId`, `accessToken` e outros que as demais pastas usam.\n\n⚠️ `POST /auth/login` tem limite de 5 tentativas por minuto por IP. Uma execução completa da coleção faz 4 logins; espere ~1 min antes de rodar de novo.',
  [
    req('Criar clínica A (signup)', 'POST', '/tenants', {
      auth: 'none',
      description:
        'Rota pública. Cria, numa transação, o tenant + papel "Admin" (todas as permissões) + usuário dono. Cada execução gera um sufixo novo, então dá para repetir sem conflito.',
      pre: [set('suffix', 'Date.now().toString(36)')],
      body: {
        name: 'Clínica {{suffix}}',
        subdomain: 'clinica-{{suffix}}',
        owner: { name: 'Dono {{suffix}}', email: 'dono-{{suffix}}@exemplo.com', password: '{{password}}' },
      },
      test: [
        status(201),
        json,
        set('tenantId', 'b.tenant.id'),
        set('ownerRoleId', 'b.role.id'),
        set('ownerId', 'b.owner.id'),
        set('ownerEmail', 'b.owner.email'),
        set('subdomain', 'b.tenant.subdomain'),
        check('o dono nasce ativo e sem senha na resposta', "b.owner.status === 'active' && b.owner.passwordHash === undefined"),
      ],
    }),
    req('Login (dono)', 'POST', '/auth/login', {
      auth: 'none',
      description: 'Devolve o JWT. O token só prova identidade: as permissões são relidas do banco a cada requisição.',
      body: { email: '{{ownerEmail}}', password: '{{password}}' },
      test: [
        status(200),
        json,
        set('accessToken', 'b.accessToken'),
        check('o dono tem as 7 permissões', 'b.user.permissions.length === 7'),
      ],
    }),
    req('Login com senha errada', 'POST', '/auth/login', {
      auth: 'none',
      description: 'A mensagem é a mesma para senha errada, email inexistente e conta desativada (não dá pista a quem enumera contas).',
      body: { email: '{{ownerEmail}}', password: 'senha-errada' },
      test: [status(401), json, check('mensagem genérica', "b.message === 'Credenciais inválidas'")],
    }),
    req('Rota protegida sem token', 'GET', '/tenants/{{tenantId}}/patients', {
      auth: 'none',
      description: 'Toda rota exige JWT, exceto as marcadas como públicas.',
      test: [status(401)],
    }),
  ],
);

// ---------- 02 · Clínica e marca ----------

const clinica = folder(
  '02 · Clínica e marca (whitelabel)',
  'Configurações da clínica, identidade visual e a resolução **pública** da marca (usada pelo frontend na tela de login, antes de existir token).',
  [
    req('Ver a clínica', 'GET', '/tenants/{{tenantId}}', {
      test: [status(200), json, check('branding ainda vazio', 'b.branding === null')],
    }),
    req('Atualizar configurações e domínio próprio', 'PATCH', '/tenants/{{tenantId}}', {
      description:
        'Duração padrão do atendimento (45 min), mínimo (15 min) e domínio próprio (validado como domínio e normalizado para minúsculas).',
      body: {
        defaultAppointmentDurationMinutes: 45,
        minAppointmentDurationMinutes: 15,
        customDomain: 'agenda-{{suffix}}.exemplo.com.br',
      },
      test: [status(200), json, set('customDomain', 'b.customDomain'), check('duração padrão 45', 'b.defaultAppointmentDurationMinutes === 45')],
    }),
    req('Tentar suspender a própria clínica', 'PATCH', '/tenants/{{tenantId}}', {
      description: 'Suspensão é ação da plataforma: o campo `status` não é aceito para o admin da clínica.',
      body: { status: 'suspended' },
      test: [status(400)],
    }),
    req('Atualizar marca', 'PATCH', '/tenants/{{tenantId}}/branding', {
      description: 'Envio parcial. Cores `#RRGGBB`; `logoUrl` só `https`.',
      body: {
        tradeName: 'Clínica Sorriso',
        logoUrl: 'https://cdn.exemplo.com/logo.png',
        primaryColor: '#1A73E8',
        secondaryColor: '#FFFFFF',
      },
      test: [status(200), json, check('cor gravada', "b.primaryColor === '#1A73E8'")],
    }),
    req('Marca inválida (cor com 8 dígitos)', 'PATCH', '/tenants/{{tenantId}}/branding', {
      description: 'Antes este valor estourava a coluna e dava 500; agora é 400.',
      body: { primaryColor: '#12345678' },
      test: [status(400)],
    }),
    req('Limpar o logo (null)', 'PATCH', '/tenants/{{tenantId}}/branding', {
      description: '`null` limpa o campo sem mexer nos outros.',
      body: { logoUrl: null },
      test: [status(200), json, check('logo limpo e cor preservada', "b.logoUrl === null && b.primaryColor === '#1A73E8'")],
    }),
    req('Marca pública — por subdomínio', 'GET', '/public/branding', {
      auth: 'none',
      description:
        'Sem login. O frontend chama com o host de onde é servido. Sem `APP_BASE_DOMAIN`, um host sem ponto vale como subdomínio. Só campos de marca são expostos.',
      query: [['host', '{{subdomain}}']],
      test: [
        status(200),
        json,
        check('só campos de marca', "Object.keys(b).sort().join() === 'logoUrl,name,primaryColor,secondaryColor,tradeName'"),
        check('nome fantasia', "b.tradeName === 'Clínica Sorriso'"),
      ],
    }),
    req('Marca pública — por domínio próprio', 'GET', '/public/branding', {
      auth: 'none',
      query: [['host', '{{customDomain}}']],
      test: [status(200), json, check('mesma clínica', "b.tradeName === 'Clínica Sorriso'")],
    }),
    req('Marca pública — host inexistente', 'GET', '/public/branding', {
      auth: 'none',
      query: [['host', 'nao-existe-{{suffix}}']],
      test: [status(404)],
    }),
  ],
);

// ---------- 03 · Papéis e permissões ----------

const papeis = folder(
  '03 · Papéis e permissões',
  'O catálogo de permissões é global; cada clínica monta os papéis que quiser. "Listar papéis" grava os ids das permissões, usados para montar os papéis seguintes.',
  [
    req('Listar papéis (e capturar ids das permissões)', 'GET', '/tenants/{{tenantId}}/roles', {
      test: [
        status(200),
        json,
        "const admin = b.find((r) => r.name === 'Admin');",
        "const id = (key) => admin.permissions.find((p) => p.permission.key === key).permission.id;",
        set('permPatientsRead', "id('patients:read')"),
        set('permPatientsWrite', "id('patients:write')"),
        set('permAppointmentsRead', "id('appointments:read')"),
        set('permAppointmentsWrite', "id('appointments:write')"),
        set('permUsersManage', "id('users:manage')"),
        set('permRolesManage', "id('roles:manage')"),
        set('permTenantManage', "id('tenant:manage')"),
        check('o papel Admin tem as 7 permissões', 'admin.permissions.length === 7'),
      ],
    }),
    req('Criar papel "Gestor"', 'POST', '/tenants/{{tenantId}}/roles', {
      description: 'Atende pacientes e agenda e também gerencia usuários — mas **não** papéis nem a clínica. É o papel do usuário limitado usado nas pastas seguintes.',
      body: {
        name: 'Gestor',
        description: 'Atende pacientes e agenda e gerencia usuários',
        permissionIds: [
          '{{permPatientsRead}}',
          '{{permPatientsWrite}}',
          '{{permAppointmentsRead}}',
          '{{permAppointmentsWrite}}',
          '{{permUsersManage}}',
        ],
      },
      test: [status(201), json, set('gestorRoleId', 'b.id'), check('5 permissões', 'b.permissions.length === 5')],
    }),
    req('Obter papel', 'GET', '/tenants/{{tenantId}}/roles/{{gestorRoleId}}', { test: [status(200)] }),
    req('Atualizar papel', 'PATCH', '/tenants/{{tenantId}}/roles/{{gestorRoleId}}', {
      body: { description: 'Gestor da recepção: pacientes, agenda e usuários' },
      test: [status(200), json, check('descrição nova', "b.description.startsWith('Gestor da recepção')")],
    }),
    req('Permissão inexistente', 'POST', '/tenants/{{tenantId}}/roles', {
      description: 'Id de permissão que não existe: erro do cliente (400), não do banco.',
      body: { name: 'Fantasma', permissionIds: ['{{$guid}}'] },
      test: [status(400)],
    }),
    req('Criar papel descartável', 'POST', '/tenants/{{tenantId}}/roles', {
      body: { name: 'Descartável', permissionIds: ['{{permPatientsRead}}'] },
      test: [status(201), json, set('disposableRoleId', 'b.id')],
    }),
    req('Apagar papel livre', 'DELETE', '/tenants/{{tenantId}}/roles/{{disposableRoleId}}', {
      test: [status(200)],
    }),
  ],
);

// ---------- 04 · Usuários ----------

const usuarios = folder(
  '04 · Usuários',
  'Cria o usuário "Gestor" (também é o profissional que atende na agenda) e mostra a duração própria de atendimento.',
  [
    req('Listar usuários', 'GET', '/tenants/{{tenantId}}/users', {
      test: [status(200), json, check('só o dono por enquanto', 'b.length === 1 && b[0].passwordHash === undefined')],
    }),
    req('Criar usuário (Gestor)', 'POST', '/tenants/{{tenantId}}/users', {
      description: 'O papel precisa ser do mesmo tenant e ter só permissões que quem cria também possui.',
      body: {
        name: 'Dra. Helena',
        email: 'gestor-{{suffix}}@exemplo.com',
        password: '{{password}}',
        roleId: '{{gestorRoleId}}',
      },
      test: [status(201), json, set('professionalId', 'b.id'), set('professionalEmail', 'b.email')],
    }),
    req('Obter usuário', 'GET', '/tenants/{{tenantId}}/users/{{professionalId}}', { test: [status(200)] }),
    req('Atualizar usuário', 'PATCH', '/tenants/{{tenantId}}/users/{{professionalId}}', {
      body: { name: 'Dra. Helena Souza' },
      test: [status(200), json, check('nome novo', "b.name === 'Dra. Helena Souza'")],
    }),
    req('Login (Gestor)', 'POST', '/auth/login', {
      auth: 'none',
      body: { email: '{{professionalEmail}}', password: '{{password}}' },
      test: [status(200), json, set('gestorToken', 'b.accessToken'), check('5 permissões', 'b.user.permissions.length === 5')],
    }),
    req('Minha duração de atendimento (Gestor)', 'PATCH', '/tenants/{{tenantId}}/users/me/appointment-settings', {
      auth: 'gestorToken',
      description: 'O próprio profissional ajusta a duração sem precisar de `users:manage`. Vale o mínimo da clínica (15 min).',
      body: { defaultAppointmentDurationMinutes: 50 },
      test: [status(200), json, check('duração 50', 'b.defaultAppointmentDurationMinutes === 50')],
    }),
    req('Voltar à duração da clínica (null)', 'PATCH', '/tenants/{{tenantId}}/users/me/appointment-settings', {
      auth: 'gestorToken',
      description: '`null` remove a duração própria e volta a valer a da clínica (45 min).',
      body: { defaultAppointmentDurationMinutes: null },
      test: [status(200), json, check('sem duração própria', 'b.defaultAppointmentDurationMinutes === null')],
    }),
    req('Desativar usuário', 'PATCH', '/tenants/{{tenantId}}/users/{{professionalId}}', {
      description: 'Efeito imediato: o token dele deixa de valer na próxima requisição.',
      body: { status: 'disabled' },
      test: [status(200)],
    }),
    req('Token do usuário desativado deixa de valer', 'GET', '/tenants/{{tenantId}}/patients', {
      auth: 'gestorToken',
      test: [status(401)],
    }),
    req('Reativar usuário', 'PATCH', '/tenants/{{tenantId}}/users/{{professionalId}}', {
      body: { status: 'active' },
      test: [status(200)],
    }),
  ],
);

// ---------- 05 · Regras de conta ----------

const regras = folder(
  '05 · Regras de conta',
  'Escalada de privilégio (403) e proteção do último administrador (409). Os passos com "(Gestor)" usam o token do usuário limitado; os demais, o do dono.',
  [
    req('Gestor não cria usuário com papel Admin', 'POST', '/tenants/{{tenantId}}/users', {
      auth: 'gestorToken',
      description: 'Só se concede o que se possui: o Gestor não tem `roles:manage` nem `tenant:manage`.',
      body: { name: 'Promovido', email: 'promovido-{{suffix}}@exemplo.com', password: '{{password}}', roleId: '{{ownerRoleId}}' },
      test: [status(403), json, check('cita as permissões que faltam', "b.message.includes('roles:manage')")],
    }),
    req('Gestor não se promove a Admin', 'PATCH', '/tenants/{{tenantId}}/users/{{professionalId}}', {
      auth: 'gestorToken',
      body: { roleId: '{{ownerRoleId}}' },
      test: [status(403)],
    }),
    req('Gestor não altera o dono (usuário "acima")', 'PATCH', '/tenants/{{tenantId}}/users/{{ownerId}}', {
      auth: 'gestorToken',
      description: 'Ninguém altera um usuário cujo papel tem permissões que o ator não tem.',
      body: { status: 'disabled' },
      test: [status(403)],
    }),
    req('Dono (único admin) não pode se desativar', 'PATCH', '/tenants/{{tenantId}}/users/{{ownerId}}', {
      description: 'O tenant precisa manter ao menos um administrador ativo (papel com `users:manage`, `roles:manage` e `tenant:manage`).',
      body: { status: 'disabled' },
      test: [status(409), json, check('cita administrador', "b.message.includes('administrador')")],
    }),
    req('Dono não pode trocar o próprio papel', 'PATCH', '/tenants/{{tenantId}}/users/{{ownerId}}', {
      body: { roleId: '{{gestorRoleId}}' },
      test: [status(409)],
    }),
    req('Não dá para tirar `tenant:manage` do papel Admin', 'PATCH', '/tenants/{{tenantId}}/roles/{{ownerRoleId}}', {
      description: 'Enviar o papel Admin sem `tenant:manage` deixaria a clínica sem administrador.',
      body: {
        permissionIds: [
          '{{permPatientsRead}}',
          '{{permPatientsWrite}}',
          '{{permAppointmentsRead}}',
          '{{permAppointmentsWrite}}',
          '{{permUsersManage}}',
          '{{permRolesManage}}',
        ],
      },
      test: [status(409)],
    }),
    req('Papel em uso não pode ser apagado', 'DELETE', '/tenants/{{tenantId}}/roles/{{gestorRoleId}}', {
      description: 'O Gestor ainda usa este papel: 409, não 500.',
      test: [status(409)],
    }),
  ],
);

// ---------- 06 · Pacientes ----------

const pacientes = folder(
  '06 · Pacientes',
  'CRUD, busca (nome, sobrenome e CPF), paginação, anamnese, exclusão e restauração.\n\nO CPF é guardado só com dígitos: `123.456.789-01` e `12345678901` são o mesmo CPF.',
  [
    req('Criar paciente (Maria)', 'POST', '/tenants/{{tenantId}}/patients', {
      body: {
        fullName: 'Maria da Silva',
        cpf: '123.456.789-01',
        birthDate: '1990-05-17',
        phone: '(11) 91234-5678',
        email: 'maria@exemplo.com',
        address: { rua: 'Rua das Flores', numero: 10, cidade: 'São Paulo' },
        notes: 'Prefere atendimento à tarde',
      },
      test: [status(201), json, set('patientId', 'b.id'), check('CPF normalizado para dígitos', "b.cpf === '12345678901'")],
    }),
    req('Criar paciente (João)', 'POST', '/tenants/{{tenantId}}/patients', {
      body: { fullName: 'João Pedro Souza', cpf: '987.654.321-00' },
      test: [status(201), json, set('patient2Id', 'b.id')],
    }),
    req('Criar paciente sem CPF (Ana)', 'POST', '/tenants/{{tenantId}}/patients', {
      body: { fullName: 'Ana Paula Lima' },
      test: [status(201), json, set('patient3Id', 'b.id')],
    }),
    req('CPF repetido em outro formato', 'POST', '/tenants/{{tenantId}}/patients', {
      description: 'O CPF é único por tenant, mesmo digitado com/sem pontuação.',
      body: { fullName: 'Maria Duplicada', cpf: '12345678901' },
      test: [status(409), json, check('cita CPF', '/cpf/i.test(b.message)')],
    }),
    req('CPF inválido', 'POST', '/tenants/{{tenantId}}/patients', {
      body: { fullName: 'Fulano', cpf: '123' },
      test: [status(400)],
    }),
    req('Listar pacientes (padrão)', 'GET', '/tenants/{{tenantId}}/patients', {
      description: 'Resposta paginada: `{ data, meta: { total, page, pageSize, totalPages } }`, em ordem alfabética.',
      query: [
        ['q', 'maria', { disabled: true, description: 'Busca livre: nome, sobrenome e/ou CPF' }],
        ['page', '1', { disabled: true }],
        ['pageSize', '20', { disabled: true, description: 'padrão 20, máximo 100' }],
      ],
      test: [
        status(200),
        json,
        check('3 pacientes, em ordem alfabética', "b.meta.total === 3 && b.data.map((p) => p.fullName).join('|') === 'Ana Paula Lima|João Pedro Souza|Maria da Silva'"),
      ],
    }),
    req('Buscar por nome e sobrenome', 'GET', '/tenants/{{tenantId}}/patients', {
      description: 'Todas as palavras precisam casar, em qualquer ordem, sem diferenciar maiúsculas.',
      query: [['q', 'silva maria']],
      test: [status(200), json, check('só a Maria', "b.data.length === 1 && b.data[0].fullName === 'Maria da Silva'")],
    }),
    req('Buscar sem acento', 'GET', '/tenants/{{tenantId}}/patients', {
      description: '`joao` encontra "João" (busca sem diferenciar acentos).',
      query: [['q', 'joao']],
      test: [status(200), json, check('achou o João', "b.data.length === 1 && b.data[0].fullName === 'João Pedro Souza'")],
    }),
    req('Buscar por CPF (parcial, com pontuação)', 'GET', '/tenants/{{tenantId}}/patients', {
      description: 'Palavra só com dígitos, `.` e `-` casa no CPF: `123.456` = `123456`.',
      query: [['q', '123.456']],
      test: [status(200), json, check('achou a Maria', "b.data.length === 1 && b.data[0].fullName === 'Maria da Silva'")],
    }),
    req('Paginar (2 por página)', 'GET', '/tenants/{{tenantId}}/patients', {
      query: [['page', '2'], ['pageSize', '2']],
      test: [status(200), json, check('página 2 de 2, com 1 item', 'b.meta.totalPages === 2 && b.meta.page === 2 && b.data.length === 1')],
    }),
    req('Parâmetro de paginação inválido', 'GET', '/tenants/{{tenantId}}/patients', {
      query: [['pageSize', '101']],
      test: [status(400)],
    }),
    req('Obter paciente', 'GET', '/tenants/{{tenantId}}/patients/{{patientId}}', { test: [status(200)] }),
    req('Atualizar paciente', 'PATCH', '/tenants/{{tenantId}}/patients/{{patientId}}', {
      body: { phone: '(11) 98888-7777' },
      test: [status(200), json, check('telefone novo e nome preservado', "b.phone === '(11) 98888-7777' && b.fullName === 'Maria da Silva'")],
    }),
    req('Registrar anamnese', 'POST', '/tenants/{{tenantId}}/patients/{{patientId}}/anamnesis-records', {
      description: 'Ficha livre em JSON. Guarda quem preencheu.',
      body: {
        answers: { queixa_principal: 'Dor de cabeça recorrente', alergias: ['dipirona'], fumante: false },
      },
      test: [status(201), json, check('autor registrado', 'b.filledByUserId === pm.collectionVariables.get("ownerId")')],
    }),
    req('Listar anamneses', 'GET', '/tenants/{{tenantId}}/patients/{{patientId}}/anamnesis-records', {
      test: [status(200), json, check('1 ficha', 'b.length === 1')],
    }),
    req('Remover paciente (João)', 'DELETE', '/tenants/{{tenantId}}/patients/{{patient2Id}}', {
      description: 'Soft delete: some das leituras, mas o registro e as fichas continuam no banco.',
      test: [status(200)],
    }),
    req('Paciente removido não aparece', 'GET', '/tenants/{{tenantId}}/patients/{{patient2Id}}', { test: [status(404)] }),
    req('Listar removidos', 'GET', '/tenants/{{tenantId}}/patients/removed', {
      description: 'Exige `patients:write`. Aceita os mesmos `q`, `page` e `pageSize`.',
      test: [status(200), json, check('João está nos removidos', 'b.data.some((p) => p.id === pm.collectionVariables.get("patient2Id"))')],
    }),
    req('Recadastrar o CPF de um removido', 'POST', '/tenants/{{tenantId}}/patients', {
      description: 'O CPF de um removido continua reservado. O 409 traz `removedPatientId` para o frontend oferecer "restaurar".',
      body: { fullName: 'João Recadastrado', cpf: '987.654.321-00' },
      test: [status(409), json, check('aponta o paciente a restaurar', 'b.removedPatientId === pm.collectionVariables.get("patient2Id")')],
    }),
    req('Restaurar paciente', 'POST', '/tenants/{{tenantId}}/patients/{{patient2Id}}/restore', {
      test: [status(201), json, check('deletedAt nulo', 'b.deletedAt === null')],
    }),
    req('Paciente restaurado volta a aparecer', 'GET', '/tenants/{{tenantId}}/patients/{{patient2Id}}', { test: [status(200)] }),
  ],
);

// ---------- 07 · Agenda ----------

const agenda = folder(
  '07 · Agenda',
  'Agendamentos do profissional (Dra. Helena) daqui a 3 dias. As datas são geradas automaticamente (variáveis `t0900`, `t1000`...), então dá para rodar em qualquer dia.\n\nRegras: um profissional não pode ter dois agendamentos ativos sobrepostos (409); só o início → fim = duração do profissional ou da clínica (45 min).',
  [
    req('Criar agendamento (só o início)', 'POST', '/tenants/{{tenantId}}/appointments', {
      description: 'Sem `endsAt`: o fim é calculado com a duração padrão da clínica (45 min, configurada na pasta 02).',
      body: { patientId: '{{patientId}}', professionalId: '{{professionalId}}', scheduledAt: '{{t0900}}', notes: 'Primeira consulta' },
      test: [
        status(201),
        json,
        set('appointmentId', 'b.id'),
        check('fim = início + 45 min', '(new Date(b.endsAt) - new Date(b.scheduledAt)) / 60000 === 45'),
        check('nasce agendado', "b.status === 'scheduled'"),
      ],
    }),
    req('Criar agendamento (início e fim)', 'POST', '/tenants/{{tenantId}}/appointments', {
      body: { patientId: '{{patientId}}', professionalId: '{{professionalId}}', scheduledAt: '{{t1000}}', endsAt: '{{t1100}}' },
      test: [status(201), json, set('appointment2Id', 'b.id'), check('60 min', '(new Date(b.endsAt) - new Date(b.scheduledAt)) / 60000 === 60')],
    }),
    req('Conflito de horário', 'POST', '/tenants/{{tenantId}}/appointments', {
      description: '09:15 cai dentro do agendamento das 09:00 (que vai até 09:45): 409.',
      body: { patientId: '{{patientId}}', professionalId: '{{professionalId}}', scheduledAt: '{{t0915}}' },
      test: [status(409)],
    }),
    req('Abaixo da duração mínima da clínica', 'POST', '/tenants/{{tenantId}}/appointments', {
      description: 'A clínica exige no mínimo 15 min; aqui são 10.',
      body: { patientId: '{{patientId}}', professionalId: '{{professionalId}}', scheduledAt: '{{t1300}}', endsAt: '{{t1310}}' },
      test: [status(400), json, check('cita o mínimo', "b.message.includes('15 minutos')")],
    }),
    req('Fim antes do início', 'POST', '/tenants/{{tenantId}}/appointments', {
      body: { patientId: '{{patientId}}', professionalId: '{{professionalId}}', scheduledAt: '{{t1100}}', endsAt: '{{t1000}}' },
      test: [status(400)],
    }),
    req('Listar agenda (padrão)', 'GET', '/tenants/{{tenantId}}/appointments', {
      description: 'Paginada (`pageSize` padrão 50, máximo 200), do mais cedo ao mais tarde. Ative os parâmetros abaixo para filtrar.',
      query: [
        ['professionalId', '{{professionalId}}', { disabled: true }],
        ['patientId', '{{patientId}}', { disabled: true }],
        ['from', '{{dayStart}}', { disabled: true, description: 'Janela por sobreposição: termina depois de `from`...' }],
        ['to', '{{dayEnd}}', { disabled: true, description: '...e começa até `to` (inclusive)' }],
        ['status', 'scheduled,confirmed', { disabled: true, description: 'um ou mais, separados por vírgula' }],
        ['page', '1', { disabled: true }],
        ['pageSize', '50', { disabled: true }],
      ],
      test: [status(200), json, check('2 agendamentos, em ordem', 'b.meta.total === 2 && b.data[0].id === pm.collectionVariables.get("appointmentId")')],
    }),
    req('Janela por sobreposição (atendimento em andamento)', 'GET', '/tenants/{{tenantId}}/appointments', {
      description:
        'Janela 09:30–10:00. O agendamento das 09:00–09:45 já começou, mas ainda está em andamento na janela — **entra**. O das 10:00 começa exatamente em `to` — **entra** (limite superior inclusivo).',
      query: [['from', '{{t0930}}'], ['to', '{{t1000}}']],
      test: [status(200), json, check('os dois entram', 'b.meta.total === 2')],
    }),
    req('Janela que só encosta (fica de fora)', 'GET', '/tenants/{{tenantId}}/appointments', {
      description: 'Janela a partir das 09:45: o das 09:00 termina exatamente às 09:45 (só encosta) e sai; entra só o das 10:00.',
      query: [['from', '{{t0945}}'], ['to', '{{t1000}}']],
      test: [status(200), json, check('só o das 10:00', 'b.meta.total === 1 && b.data[0].id === pm.collectionVariables.get("appointment2Id")')],
    }),
    req('Janela invertida', 'GET', '/tenants/{{tenantId}}/appointments', {
      query: [['from', '{{t1100}}'], ['to', '{{t0900}}']],
      test: [status(400)],
    }),
    req('Obter agendamento', 'GET', '/tenants/{{tenantId}}/appointments/{{appointmentId}}', { test: [status(200)] }),
    req('Remarcar (só o início)', 'PATCH', '/tenants/{{tenantId}}/appointments/{{appointmentId}}', {
      description: 'Ao remarcar só o início, a duração original (45 min) é mantida.',
      body: { scheduledAt: '{{t1200}}' },
      test: [status(200), json, check('duração mantida', '(new Date(b.endsAt) - new Date(b.scheduledAt)) / 60000 === 45')],
    }),
    req('Confirmar', 'PATCH', '/tenants/{{tenantId}}/appointments/{{appointmentId}}', {
      body: { status: 'confirmed' },
      test: [status(200), json, check('confirmado', "b.status === 'confirmed'")],
    }),
    req('Transição de status inválida', 'PATCH', '/tenants/{{tenantId}}/appointments/{{appointmentId}}', {
      description: '`confirmed → scheduled` não existe. Transições: scheduled → confirmed | completed | cancelled | no_show; confirmed → completed | cancelled | no_show.',
      body: { status: 'scheduled' },
      test: [status(409)],
    }),
    req('Cancelar (DELETE)', 'DELETE', '/tenants/{{tenantId}}/appointments/{{appointmentId}}', {
      description: 'Cancela, não apaga: o registro continua, com status `cancelled`.',
      test: [status(200)],
    }),
    req('Listar só os cancelados', 'GET', '/tenants/{{tenantId}}/appointments', {
      query: [['status', 'cancelled']],
      test: [status(200), json, check('achou o cancelado', "b.meta.total === 1 && b.data[0].status === 'cancelled'")],
    }),
    req('Listar sem cancelados (calendário)', 'GET', '/tenants/{{tenantId}}/appointments', {
      description: 'Para uma grade sem cancelados e faltas: `status=scheduled,confirmed,completed`.',
      query: [['status', 'scheduled,confirmed,completed']],
      test: [status(200), json, check('só o das 10:00', 'b.meta.total === 1 && b.data[0].id === pm.collectionVariables.get("appointment2Id")')],
    }),
    req('Status inválido no filtro', 'GET', '/tenants/{{tenantId}}/appointments', {
      query: [['status', 'arquivado']],
      test: [status(400)],
    }),
  ],
  [
    '// Datas de 3 dias à frente (UTC), recalculadas a cada requisição desta pasta.',
    'const now = new Date();',
    'const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3);',
    'const at = (h, m = 0) => new Date(day + (h * 60 + m) * 60000).toISOString();',
    "pm.collectionVariables.set('dayStart', at(0));",
    "pm.collectionVariables.set('dayEnd', at(23, 59));",
    "pm.collectionVariables.set('t0900', at(9));",
    "pm.collectionVariables.set('t0915', at(9, 15));",
    "pm.collectionVariables.set('t0930', at(9, 30));",
    "pm.collectionVariables.set('t0945', at(9, 45));",
    "pm.collectionVariables.set('t1000', at(10));",
    "pm.collectionVariables.set('t1100', at(11));",
    "pm.collectionVariables.set('t1200', at(12));",
    "pm.collectionVariables.set('t1300', at(13));",
    "pm.collectionVariables.set('t1310', at(13, 10));",
  ],
);

// ---------- 08 · Isolamento entre clínicas ----------

const isolamento = folder(
  '08 · Isolamento entre clínicas',
  'Cria uma segunda clínica (B) e prova que ela não enxerga nem altera dados da clínica A.',
  [
    req('Criar clínica B (signup)', 'POST', '/tenants', {
      auth: 'none',
      pre: [set('suffixB', "Date.now().toString(36) + 'b'")],
      body: {
        name: 'Clínica {{suffixB}}',
        subdomain: 'clinica-{{suffixB}}',
        owner: { name: 'Dono B', email: 'dono-{{suffixB}}@exemplo.com', password: '{{password}}' },
      },
      test: [status(201), json, set('tenantBId', 'b.tenant.id'), set('ownerBId', 'b.owner.id'), set('ownerBEmail', 'b.owner.email')],
    }),
    req('Login (dono da clínica B)', 'POST', '/auth/login', {
      auth: 'none',
      body: { email: '{{ownerBEmail}}', password: '{{password}}' },
      test: [status(200), json, set('tokenB', 'b.accessToken')],
    }),
    req('Token B na URL da clínica A', 'GET', '/tenants/{{tenantId}}/patients', {
      auth: 'tokenB',
      description: 'O `:tenantId` da URL precisa bater com o do token.',
      test: [status(403)],
    }),
    req('Paciente da clínica A pela URL da clínica B', 'GET', '/tenants/{{tenantBId}}/patients/{{patientId}}', {
      auth: 'tokenB',
      description: 'Mesmo com o id certo, o paciente é de outro tenant: 404 (não vaza que existe).',
      test: [status(404)],
    }),
    req('A clínica B não vê pacientes da A', 'GET', '/tenants/{{tenantBId}}/patients', {
      auth: 'tokenB',
      test: [status(200), json, check('lista vazia', 'b.meta.total === 0')],
    }),
    req('Agendar com paciente de outra clínica', 'POST', '/tenants/{{tenantBId}}/appointments', {
      auth: 'tokenB',
      description: 'O FK do banco aceitaria; a API confere que o paciente é do tenant.',
      body: { patientId: '{{patientId}}', professionalId: '{{ownerBId}}', scheduledAt: '{{t1000}}' },
      test: [status(400), json, check('paciente inválido para este tenant', "b.message.includes('patientId')")],
    }),
  ],
  [
    '// Reaproveita as datas da pasta de agenda (o Runner executa em ordem; manualmente, rode a 07 antes).',
    "if (!pm.collectionVariables.get('t1000')) {",
    '  const now = new Date();',
    '  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3);',
    "  pm.collectionVariables.set('t1000', new Date(day + 10 * 3600000).toISOString());",
    '}',
  ],
);

// ---------- montagem ----------

const collection = {
  info: {
    name: 'bem-te-vi API',
    description:
      'Roteiro de ponta a ponta da API do bem-te-vi (SaaS whitelabel de clínicas e hospitais).\n\n' +
      '**Como usar**\n' +
      '1. Suba a API (`docker compose up -d` + `npm run start:dev`, ou `docker compose --profile app up -d --build`).\n' +
      '2. Ajuste `baseUrl` (variável da coleção ou do ambiente "bem-te-vi · local").\n' +
      '3. Rode as pastas **em ordem** (a 01 cria a clínica e o token; as demais usam o que as anteriores gravaram). Dá para rodar tudo de uma vez no Collection Runner.\n\n' +
      '**Variáveis** ficam gravadas automaticamente por scripts (`tenantId`, `accessToken`, `patientId`...). Cada execução cria uma clínica nova, então pode repetir sem conflito.\n\n' +
      '**Limites da API em dev:** 100 requisições/min por IP no total, 5/min em `POST /auth/login` e 10/min em `POST /tenants`. Se receber 429, espere um minuto.\n\n' +
      '**Insomnia:** importe este mesmo arquivo. Os scripts (que gravam as variáveis e checam as respostas) só rodam se a sua versão tiver suporte a scripts com a API `pm.*`; senão, copie os valores (`tenantId`, `accessToken`...) manualmente para as variáveis.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: bearer('accessToken'),
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3000' },
    { key: 'password', value: 'Senha@12345' },
  ],
  item: [saude, autenticacao, clinica, papeis, usuarios, regras, pacientes, agenda, isolamento],
};

const environment = {
  name: 'bem-te-vi · local',
  values: [{ key: 'baseUrl', value: 'http://localhost:3000', type: 'default', enabled: true }],
  _postman_variable_scope: 'environment',
};

writeFileSync(join(OUT, 'bem-te-vi.postman_collection.json'), JSON.stringify(collection, null, 2) + '\n');
writeFileSync(join(OUT, 'bem-te-vi.local.postman_environment.json'), JSON.stringify(environment, null, 2) + '\n');

const count = (items) => items.reduce((n, i) => n + (i.item ? count(i.item) : 1), 0);
console.log(`Coleção gerada: ${collection.item.length} pastas, ${count(collection.item)} requisições.`);
