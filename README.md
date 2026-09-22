# bem-te-vi-api

API do bem-te-vi — SaaS whitelabel de gestão de clínicas e hospitais (agenda de consultas, cadastro de pacientes com anamnese, multi-tenant com permissões por papel).

## Stack

- Node.js + NestJS
- PostgreSQL + Prisma ORM (driver adapter `@prisma/adapter-pg`)

## Rodando localmente

1. Suba um Postgres local (requer Docker):

   ```bash
   docker compose up -d
   ```

2. Copie o `.env.example` para `.env` e ajuste se necessário:

   ```bash
   cp .env.example .env
   ```

3. Instale as dependências e rode as migrations:

   ```bash
   npm install
   npx prisma migrate dev --name init
   ```

4. Popule o catálogo base de permissões:

   ```bash
   npx prisma db seed
   ```

5. Suba a API:

   ```bash
   npm run start:dev
   ```

6. Opcional — crie o primeiro admin do backoffice da plataforma (ver "Backoffice da plataforma" abaixo):

   ```bash
   PLATFORM_ADMIN_EMAIL=voce@empresa.com PLATFORM_ADMIN_PASSWORD="senha-forte" npm run bootstrap:platform
   ```

### Rodando tudo em containers

Alternativa ao passo a passo acima: sobe Postgres + API na imagem do `Dockerfile`. Só precisa do `.env` (o `JWT_SECRET` é obrigatório):

```bash
docker compose --profile app up -d --build
```

Na subida, o container aplica as migrations (`prisma migrate deploy`) e o seed do catálogo de permissões (idempotente) antes de iniciar a API em `http://localhost:3000` (`PORT` do `.env` muda a porta do host). Sem `--profile app`, `docker compose up -d` continua subindo só o banco, para o fluxo de dev com a API no host e hot reload.

Notas para deploy:
- Imagem multi-stage (`node:24-bookworm-slim`), roda como usuário não-root, com `HEALTHCHECK` em `GET /` e shutdown gracioso no SIGTERM.
- Configuração toda por variável de ambiente (`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`); `.env` nunca entra na imagem.
- Migrate + seed rodam em cada start do container. Com mais de uma réplica, mova essa etapa para um passo único de release.
- A imagem mantém o `node_modules` completo (CLI do Prisma e `tsx` para migrate/seed), então fica grande (~1 GB); dá para enxugar depois separando um job de migração.

## Modelo de dados

Fonte da verdade: `prisma/schema.prisma`. Cobre tenancy/branding (whitelabel), usuários e papéis com permissões, pacientes com ficha de anamnese (soft delete) e agenda de consultas.

## Estrutura

Cada domínio de negócio é um módulo Nest em `src/` (`tenants`, `users`, `roles`, `patients`, `appointments`), todos falando com o banco via `PrismaService` (`src/prisma`).

Rotas de negócio são aninhadas sob `/tenants/:tenantId/...`.

## Onboarding de um tenant novo

`POST /tenants` é pública e cria, numa transação só, o tenant + uma role "Admin" (com todas as permissões do catálogo) + o usuário dono:

```json
{
  "name": "Clínica Exemplo",
  "subdomain": "clinica-exemplo",
  "owner": { "name": "Fulano", "email": "fulano@clinica.com", "password": "..." }
}
```

Depois disso, o dono já pode logar (`POST /auth/login`) e criar mais usuários/papéis do tenant dele.

## Pacientes

- CRUD sob `/tenants/:tenantId/patients`; `DELETE` é soft delete (o registro e as fichas de anamnese continuam no banco, só somem das leituras).
- **CPF guardado só com dígitos (11).** Aceita com ou sem pontuação na entrada (`123.456.789-01` e `12345678901` são o mesmo CPF) e sempre volta sem pontuação; o frontend formata para exibir. `null` limpa o campo. Sem essa normalização a unique e a busca por CPF não seriam confiáveis.
- **CPF único por tenant, inclusive entre removidos.** O CPF de um paciente removido continua reservado, para não duplicar cadastro/prontuário. Tentar cadastrar (ou trocar para) esse CPF devolve `409` com `removedPatientId`, para o cliente oferecer "restaurar".
- **Restauração:** `GET /patients/removed` lista os removidos e `POST /patients/:id/restore` desfaz o soft delete (dados e anamnese voltam intactos). Ambos exigem `patients:write`.

### Listagem, busca e paginação

`GET /tenants/:tenantId/patients` (e `GET /patients/removed`, com os mesmos parâmetros):

| Parâmetro | Padrão | Regra |
|---|---|---|
| `q` | — | busca livre (até 100 caracteres) |
| `page` | `1` | inteiro ≥ 1 |
| `pageSize` | `20` | inteiro de 1 a 100 |

Resposta: `{ "data": [...pacientes], "meta": { "total", "page", "pageSize", "totalPages" } }`. Ordem: nome (A–Z) com desempate por id, para as páginas não repetirem nem pularem registros; os removidos vêm do mais recentemente removido para o mais antigo. Página além da última devolve `data: []` com o `total` correto. Parâmetro inválido ou desconhecido → `400`.

**Como a busca `q` funciona.** O texto é separado em palavras e **todas** precisam casar:
- palavra com letras → casa no nome, em qualquer posição e ordem, sem diferenciar maiúsculas nem acentos (`joao silva` encontra "João da Silva"; `conceicao` encontra "Conceição");
- palavra só com dígitos e `.`/`-` → casa no CPF, completo ou parcial, com ou sem pontuação (`123.456` = `123456`);
- as duas se combinam: `maria 1234` = nome com "maria" **e** CPF contendo "1234". Curingas (`%`, `_`) e SQL digitados valem como texto literal.

Implementação: os ids da página saem de SQL parametrizado (usa a extensão `unaccent`, criada pela migration `patient_search`; o usuário do banco precisa poder criá-la, o que é permitido a quem tem `CREATE` no banco por ser extensão *trusted*), e os registros vêm pelo Prisma. Sem índice de trigram por enquanto: cada busca varre os pacientes do tenant, o que basta para milhares de cadastros; se um tenant crescer muito, adicionar `pg_trgm`. **Limite:** uma palavra só com dígitos é sempre tratada como CPF, então um nome cadastrado com número isolado não é achado por esse número.

### Anamnese: formulário configurável por tenant

Cada clínica define os próprios campos da ficha (chave, rótulo, tipo, obrigatório, opções) em `AnamnesisTemplate`, em vez de um JSON livre sem forma nenhuma. `POST` num paciente é validado contra o `templateId` informado.

**Gerenciar formulários** — `/tenants/:tenantId/anamnesis-templates` (`anamnesis_templates:manage` para criar/editar/apagar; `patients:read` basta para listar/ler, já que quem preenche anamnese só precisa saber a forma do formulário, não editá-lo):

```json
{
  "name": "Ficha padrão",
  "fields": [
    { "key": "queixa_principal", "label": "Queixa principal", "type": "textarea", "required": true },
    { "key": "idade", "label": "Idade", "type": "number", "required": false },
    { "key": "fumante", "label": "Fumante?", "type": "boolean", "required": false },
    { "key": "inicio_sintomas", "label": "Início dos sintomas", "type": "date", "required": false },
    { "key": "tipo_sanguineo", "label": "Tipo sanguíneo", "type": "select", "required": false, "options": ["A", "B", "AB", "O"] },
    { "key": "alergias", "label": "Alergias", "type": "multiselect", "required": false, "options": ["dipirona", "penicilina"] }
  ]
}
```

- `key`: identificador (snake_case: `^[a-z][a-z0-9_]*$`), único dentro do formulário — vira a chave em `answers`.
- `type`: `text`, `textarea`, `number`, `boolean`, `date`, `select`, `multiselect`. `select`/`multiselect` exigem `options` (≥ 1 item); os demais tipos não podem ter `options`.
- `DELETE` apaga o formulário; se algum paciente já tem anamnese registrada com ele, dá `409` (FK `Restrict`), não `500` — apagar perderia o contexto de fichas antigas.
- Editar os campos de um formulário já usado é permitido (sem versionamento): fichas antigas mantêm o que foi salvo; a validação nova só vale para os próximos registros.

**Preencher (`POST /tenants/:tenantId/patients/:id/anamnesis-records`)** passa a exigir `{ templateId, answers }`. `answers` é validado contra os campos do template indicado — tipo errado, campo obrigatório ausente ou chave que não existe no formulário dão `400` com a lista de problemas (não só o primeiro). A resposta inclui `template: { id, name }` para o cliente não precisar de uma segunda chamada para saber o que renderizar.

**Sem migração automática de dados livres:** como o MVP anterior guardava `answers` sem forma nenhuma, esta mudança é incompatível com fichas antigas hipotéticas fora daqui (não havia nenhuma em produção até este ponto). Times que já tiverem dados reais no formato antigo precisam migrar `answers` para um `AnamnesisTemplate` antes de atualizar.

## Whitelabel / branding

- **Configurar (admin da clínica, `tenant:manage`):** `PATCH /tenants/:id/branding` com `tradeName`, `logoUrl`, `primaryColor`, `secondaryColor`. Envio parcial; `null` limpa o campo. Cores `#RRGGBB`; `logoUrl` só `https`. `customDomain` (em `PATCH /tenants/:id` ou no signup) é validado como domínio e normalizado para minúsculas.
- **Resolver a marca antes do login (público):** `GET /public/branding?host=<host do frontend>` → `{ name, tradeName, logoUrl, primaryColor, secondaryColor }`. O frontend chama com o `window.location.host` para tematizar a tela de login.
  - Domínio próprio: casa por igualdade exata com `customDomain`, e só se ele estiver **verificado** (ver abaixo). Um domínio reivindicado mas não verificado nunca resolve.
  - Subdomínio: `<sub>.<APP_BASE_DOMAIN>` (defina `APP_BASE_DOMAIN`, ex.: `bemtevi.com.br`); sem ele, um host sem ponto é tratado como o próprio subdomínio (dev: `?host=clinica-a`).
  - Porta, maiúsculas e ponto final são ignorados. Clínica inexistente, suspensa ou com domínio não verificado → `404`. Só campos de marca são expostos (nada de id, status ou configurações). Resposta com `Cache-Control: public, max-age=60`.
- **Verificação de domínio próprio (prova de posse por DNS):** ao definir `customDomain`, a clínica ganha um desafio TXT que precisa colocar no próprio DNS antes que esse domínio controle a marca exibida.
  - `GET /tenants/:id/domain` (`tenant:manage`) → `{ domain, verified, verifiedAt, record: { type: "TXT", name: "_bemtevi-challenge.<domain>", value } }`.
  - `POST /tenants/:id/domain/verify` (`tenant:manage`) consulta o DNS agora; sempre `200`, com `verified: false` enquanto o registro não propagou (não é erro, é um estado normal de "ainda não" — o cliente chama de novo mais tarde). Uma vez verificado, fica assim até o domínio mudar de valor.
  - Trocar `customDomain` gera um novo desafio e zera a verificação (o token antigo não vale mais); reenviar o mesmo valor não mexe numa verificação já feita; remover (`null`) libera o domínio para outro tenant reivindicar.
  - O nome do subdomínio do desafio (`_bemtevi-challenge`, não o apex do domínio do cliente) evita colidir com SPF/DKIM que o domínio já possa ter — convenção igual à da Vercel (`_vercel`).
  - Sem verificação de posse antes disso, qualquer signup podia declarar o domínio de um terceiro e passava a controlar a marca exibida nesse host (risco de phishing) — era a limitação conhecida documentada aqui antes; a lacuna está fechada, mas o domínio ainda não expira se nunca for verificado (squatting de longo prazo é um problema separado, não resolvido).
  - Upload de logo ainda não existe (só a URL, que precisa ser `https`).

## Agenda

**Duração do atendimento.** `POST /tenants/:tenantId/appointments` aceita dois modos:

- início e fim explícitos: `{ scheduledAt, endsAt }`;
- só o início: `{ scheduledAt }` — o fim é calculado com a duração padrão do profissional (`User.defaultAppointmentDurationMinutes`) ou, se ele não tiver, a da clínica (`Tenant.defaultAppointmentDurationMinutes`, 30 min por padrão).

Configuração: a clínica define `defaultAppointmentDurationMinutes` e `minAppointmentDurationMinutes` (piso aplicado aos dois modos; ex.: psicologia com mínimo de 60) via `PATCH /tenants/:id` (ou no signup). O profissional ajusta a própria duração em `PATCH /tenants/:tenantId/users/me/appointment-settings` (`null` volta a usar a da clínica); quem tem `users:manage` também pode definir a de outro usuário.

**Regras.**
- Um profissional não pode ter dois agendamentos ativos (`scheduled`, `confirmed`, `completed`) com horários sobrepostos (409). A checagem roda numa transação com advisory lock por profissional, para evitar corrida entre requisições simultâneas.
- Ao remarcar só o início, a duração original é mantida.
- Transições de status: `scheduled → confirmed | completed | cancelled | no_show`; `confirmed → completed | cancelled | no_show`. `completed`, `cancelled` e `no_show` são finais: só as observações podem mudar.
- `DELETE` cancela o agendamento (não apaga).

**Listagem, filtros e paginação.** `GET /tenants/:tenantId/appointments`:

| Parâmetro | Regra |
|---|---|
| `professionalId`, `patientId` | UUID do profissional / paciente |
| `from`, `to` | janela de datas (ISO 8601); qualquer um dos dois pode ser omitido |
| `status` | um ou mais status: `status=scheduled,confirmed` (ou repetido, `status=a&status=b`); sem o parâmetro, todos; vazio = sem filtro |
| `page` | padrão `1` |
| `pageSize` | padrão `50`, máximo `200` (maior que o dos pacientes: uma visão de calendário precisa de muitos itens de uma vez) |

**Janela `from`/`to` por sobreposição.** Entram os agendamentos que ocupam algum instante da janela: os que **terminam depois de `from`** e **começam até `to`** (inclusive). Assim um atendimento em andamento (09:30–10:30 com `from=10:00`) e um mais longo que a janela aparecem; quem termina exatamente em `from` só encosta e fica de fora; quem começa exatamente em `to` entra. `from` depois de `to` → `400`.

Resposta: `{ "data": [...], "meta": { "total", "page", "pageSize", "totalPages" } }`, do mais cedo ao mais tarde, com desempate por id (dois agendamentos no mesmo horário não trocam de lugar entre páginas). O `total` respeita todos os filtros. Página além da última devolve `data: []`; parâmetro inválido ou desconhecido → `400`. Sem `status`, cancelados e faltas aparecem (com o `status`): para uma grade sem eles, use `status=scheduled,confirmed,completed`. O índice `(tenant_id, scheduled_at)` sustenta a consulta; a condição de fim (`endsAt > from`) é filtrada em cima dele, o que basta para o volume de uma clínica, mas, com anos de histórico e janelas no passado, vale medir e considerar um índice em `(tenant_id, ends_at)`.

## Autenticação e autorização (`src/auth`)

- Login: `POST /auth/login` com `{ email, password }` → retorna um JWT (`accessToken`) e os dados do usuário (`tenantId`, `roleId`, `permissions` — chaves do catálogo de `Permission`).
- Toda rota é protegida por padrão (`JwtAuthGuard` global). Para deixar uma rota pública, use `@Public()`.
- `TenantAccessGuard` bloqueia (403) qualquer request cujo `:tenantId` da URL não bata com o `tenantId` do token — impede um usuário de um tenant acessar dados de outro só trocando a URL.
- `PermissionsGuard` + `@RequirePermissions('patients:write')` etc. checam as permissões atuais do usuário (relidas do banco) contra as exigidas pela rota.
- `@CurrentUser()` injeta `{ userId, tenantId, roleId, permissions }` no handler.
- Rate limit global de 100 req/min por IP (`@nestjs/throttler`), com limite mais agressivo (5 req/min) em `POST /auth/login` contra força bruta.
- `helmet` aplica cabeçalhos de segurança padrão (CSP, HSTS, etc.) em todas as respostas.
- `RequestLoggerMiddleware` loga método/rota/status/duração/IP de cada request (auditoria básica).

**Estado sempre fresco.** O token só prova identidade: a cada request o `JwtStrategy` relê do banco o usuário, o status do tenant e as permissões do papel (uma query por PK). Por isso desativar um usuário, suspender um tenant ou mudar as permissões de um papel tem efeito imediato (401/403), sem esperar o token expirar nem exigir novo login. Login também é recusado (401, mesma mensagem genérica) para usuário desativado ou tenant suspenso.

**Suspensão de tenant** é ação da plataforma: `status` não é aceito em `PATCH /tenants/:id`, para o admin da clínica não conseguir suspender (ou reativar) o próprio tenant. Enquanto não existir um painel/papel de plataforma, altera-se direto no banco.

## Regras de conta (usuários e papéis)

Centralizadas em `AccessPolicyService` (`src/access`), usado por `UsersService` e `RolesService`.

**Sem escalada de privilégio** (403). Compara as permissões *atuais* do ator (relidas do banco a cada request):
- só se concede o que se possui: criar/editar um papel, criar um usuário com um papel ou atribuir um papel a alguém exige que o ator tenha todas as permissões envolvidas (quem tem `users:manage` não consegue se promover a Admin);
- ninguém altera um usuário ou papel "acima" de si (cujo papel tem permissões que o ator não tem), mesmo para renomear, desativar ou apagar;
- alterar a si mesmo é permitido, dentro das regras de concessão (dá para se rebaixar, não para se promover).

**Sempre existe um administrador ativo** (409). "Administrador" é quem está ativo e tem um papel com `users:manage`, `roles:manage` e `tenant:manage` (definido pelas permissões, não pelo nome do papel). Desativar o último, trocar o papel dele ou tirar essas permissões do papel é recusado e desfeito. A checagem roda numa transação com advisory lock por tenant, para dois admins não se rebaixarem ao mesmo tempo. Um tenant que já estava sem administrador não é bloqueado por isso.

Outros ajustes: permissão inexistente em `permissionIds` responde 400 (antes vazava erro de FK); o email é gravado em minúsculas também na edição.

**Listagem e paginação.** `GET /tenants/:tenantId/users` e `GET /tenants/:tenantId/roles` são paginados (mesmo padrão de pacientes/agenda: `{ "data": [...], "meta": { "total", "page", "pageSize", "totalPages" } }`, `page` padrão `1`, `pageSize` padrão `20` e máximo `100`; parâmetro inválido ou desconhecido → `400`). Ordenados por nome, com desempate por id. Sem busca por texto por enquanto (`q`) — são listas tipicamente pequenas por clínica; se isso mudar, adicionar do mesmo jeito que em pacientes.

## Backoffice da plataforma (`src/platform`)

Gerencia as clínicas **como contas** (listar, suspender/reativar) — não é um jeito de acessar prontuário, agenda ou anamnese de nenhuma clínica; isso continua isolado por `TenantAccessGuard` como sempre foi, sem exceção.

- `GET /platform/tenants` — paginado (mesmo contrato de pacientes/agenda/usuários), com `_count.users` e `_count.patients` por clínica. A própria clínica-plataforma nunca aparece na lista.
  - **Busca (`q`):** mesma regra de pacientes — cada palavra precisa casar (em nome, subdomínio **ou** domínio próprio), sem diferenciar maiúsculas/acentos no nome (`unaccent`), curingas do LIKE tratados como texto literal. Útil porque, ao contrário de usuários/papéis por clínica, o número de clínicas cresce com o negócio.
- `PATCH /platform/tenants/:id/status` — `{ "status": "active" | "suspended" }`. É a ação que antes só existia mexendo direto no banco.
- Ambas exigem a permissão `platform:manage`.

**Como isso não vira uma porta para escalar privilégio.** `platform:manage` é uma permissão do mesmo catálogo global de sempre, mas o signup público (`POST /tenants`) a exclui explicitamente da concessão automática ao papel "Admin" de uma clínica nova (`TenantsService.create`, comentado como `CRÍTICO` no código). Sem essa exclusão, qualquer pessoa que se cadastrasse publicamente ganharia acesso ao backoffice — testado e comprovado em `platform.e2e-spec.ts` (removi a exclusão de propósito para confirmar que o teste pega; ela derruba 2 testes).

**Rotas fora da árvore `/tenants/:tenantId/...` de propósito.** Sem `:tenantId` na URL, o `TenantAccessGuard` global nem tem o que checar (ele já ignora rotas sem esse parâmetro) — o controle de acesso é só a permissão, igual a qualquer outra rota da API.

**Como criar o primeiro admin do backoffice.** Nunca pelo signup público — um script dedicado:

```bash
PLATFORM_ADMIN_EMAIL=voce@empresa.com PLATFORM_ADMIN_PASSWORD="senha-forte" npm run bootstrap:platform
```

Cria a clínica-plataforma (`Tenant.isPlatform = true`, invisível nas listagens normais e neste backoffice), o papel com `platform:manage` e o usuário — tudo idempotente (rodar de novo não duplica nada nem reseta senha de quem já existe). Depende do catálogo de permissões já ter sido semeado (`npx prisma db seed`). A própria clínica-plataforma não pode ser suspensa por `PATCH /platform/tenants/:id/status` (dá `404`, como se não existisse ali).

## CI (`.github/workflows/ci.yml`)

Roda em todo push em `main` e em cada pull request. Quatro jobs; os três últimos só começam depois de `checks` passar, para não gastar minutos de CI num branch com erro de lint/tipo:

| Job | O que valida |
|---|---|
| `checks` | `npm run lint` (oxlint type-aware) + `npm run typecheck` (`tsc --noEmit`) |
| `unit` | `npm test` (58 testes, sem banco) |
| `e2e` | `npm run test:e2e` (224 testes) contra um Postgres de serviço do próprio Actions; `prisma migrate deploy` (não `migrate dev`: é o comando de produção, não interativo) + `prisma db seed` antes |
| `docker-smoke` | Sobe a stack real via `docker compose --profile app up -d --build` (a mesma imagem e o mesmo `migrate deploy`/seed automáticos do deploy) e roda a coleção do Postman contra ela por HTTP de verdade (`docs/api/`, via `newman`) — único job que exercita o bootstrap completo (helmet, CORS, rate limit real) e a imagem Docker em si |

`newman` roda via `npx --yes newman@<versão fixa>` só dentro do job, e não é dependência do projeto: o `Dockerfile` mantém o `node_modules` completo em produção (`prisma`/`tsx` do `migrate deploy`+seed no container), e `newman` sozinho traz ~120 pacotes transitivos e dezenas de vulnerabilidades reportadas — sem necessidade, isso vazaria para a imagem publicada.

## Testando a API manualmente (Postman / Insomnia)

Em `docs/api/` há uma coleção com todas as rotas, em formato Postman v2.1 (o Insomnia também importa):

- `bem-te-vi.postman_collection.json` — 9 pastas, 82 requisições, em ordem de uso: saúde, autenticação, clínica e marca, papéis, usuários, regras de conta, pacientes (busca/paginação/restauração), agenda (janela, status, conflitos) e isolamento entre clínicas.
- `bem-te-vi.local.postman_environment.json` — ambiente com `baseUrl` (`http://localhost:3000`).

**Como usar:** suba a API, importe os dois arquivos, selecione o ambiente e rode as pastas **em ordem** (a `01` cria a clínica e grava o token; as demais reaproveitam `tenantId`, `accessToken`, ids etc., gravados por scripts). Também roda tudo de uma vez no Collection Runner. Cada execução cria clínicas novas (sufixo aleatório), então pode repetir sem conflito. Cada requisição traz uma descrição da regra que demonstra e asserções do resultado esperado (inclusive os erros: 401, 403, 404, 409...).

**Limites em dev:** 100 requisições/min por IP no total, 5/min em `POST /auth/login` e 10/min em `POST /tenants`. Uma execução completa faz 82 requisições e 4 logins, então espere ~1 min entre execuções completas (senão vem `429`).

**Insomnia:** os scripts (que gravam as variáveis e checam as respostas) só funcionam em versões com suporte à API `pm.*`; senão, copie os valores para as variáveis manualmente. Não testei a importação no Insomnia.

**Regenerar:** a coleção é gerada por `node docs/api/build-collection.mjs` (edite o script, não o JSON). Também dá para rodá-la sem interface: `npx newman run docs/api/bem-te-vi.postman_collection.json -e docs/api/bem-te-vi.local.postman_environment.json --delay-request 150`.

## Testes

- `npm run lint` / `npm run typecheck` — oxlint (type-aware) e `tsc --noEmit`.
- `npm test` — unitários (não precisam de banco).
- `npm run test:e2e` — ponta a ponta, contra o Postgres do `.env` (`docker compose up -d`, `prisma migrate dev` e `prisma db seed` antes). Cada execução cria tenants com sufixo único e remove tudo no final; o rate limit é desligado na suíte. Setup compartilhado em `test/helpers/e2e.ts`.
  - `retry: 2` no config de e2e (`vitest.config.e2e.ts`): esses testes fazem muitas requisições reais contra o Postgres do Docker, e volume alto ocasionalmente esbarra em instabilidade de rede do ambiente (`ECONNRESET`, mais comum no Docker Desktop do Windows), não em bug de lógica — uma asserção errada continua falhando na repetição. A causa raiz mais comum (pool do Prisma sem TCP keepalive) já foi corrigida em `PrismaService`; o retry cobre o que sobra dessa classe de flake, mas só ajuda dentro de um `it()` — uma falha no `beforeAll` (setup do arquivo) derruba o arquivo inteiro sem repetir. Por isso o CI também reexecuta o comando `test:e2e` uma vez se ele falhar (ver abaixo).
  - `auth.e2e-spec.ts` — signup, login, isolamento entre tenants, RBAC, suspensão/desativação.
  - `users-roles-pagination.e2e-spec.ts` — paginação de usuários e papéis: páginas sem repetir/pular, ordenação por nome com desempate por id (usuários; papéis não têm nome duplicado por causa da unique), total conforme o tenant, limites e validação.
  - `platform.e2e-spec.ts` — backoffice: acesso (401/403), listagem (contagens, exclusão da própria clínica-plataforma), busca por nome/subdomínio/domínio próprio (acentos, curingas, SQL como texto), suspender/reativar, e o teste crítico de que o signup público nunca ganha `platform:manage` (comprovado removendo a exclusão de propósito: derruba 2 testes).
  - `patients.e2e-spec.ts` — CRUD, soft delete e restauração, CPF (normalização e unique), anamnese (com template), isolamento.
  - `anamnesis-templates.e2e-spec.ts` — CRUD de formulários, validação da forma dos campos (tipos, select/multiselect exigindo opções, key única/padrão), 409 ao apagar em uso, permissões, e a validação de `answers` na integração com pacientes.
  - `patients-search.e2e-spec.ts` — busca por nome/sobrenome/CPF (acentos, ordem, parcial), curingas e SQL como texto, paginação (páginas sem repetir/pular, limites, validação) e isolamento entre tenants.
  - `branding.e2e-spec.ts` — `PATCH` de branding (validações), `customDomain` e resolução pública por host.
  - `domain-verification.e2e-spec.ts` — desafio TXT, verificação (certo/errado/múltiplos registros/DNS fora do ar), troca/remoção de domínio, permissões e isolamento. Usa um `DnsTxtResolver` falso injetado via `createTestApp({ dnsTxtResolver })` (não dá para provar o caminho feliz com DNS real num teste automatizado).
  - `appointments-filters.e2e-spec.ts` — janela `from`/`to` por sobreposição (em andamento, envolvente, bordas exatas) e filtro por `status` (lista, repetido, vazio, inválido, combinações).
  - `appointments-pagination.e2e-spec.ts` — paginação da agenda: páginas sem repetir/pular, desempate estável (5 agendamentos no mesmo horário), total conforme filtros, limites e validação.
  - `appointments.e2e-spec.ts` — duração, conflitos, remarcação, status, filtros e **concorrência** (requisições simultâneas provam o advisory lock; sem ele os testes de corrida falham).
  - `errors.e2e-spec.ts` — erros de unique/FK do banco viram 409/404 (`PrismaExceptionFilter`), nunca 500.
  - `account-rules.e2e-spec.ts` — escalada de privilégio (usuários e papéis), último administrador e corrida entre admins (sem o lock por tenant os testes de concorrência falham).
