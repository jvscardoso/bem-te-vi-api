# Arquitetura da bem-te-vi-api

Visão de como a API é organizada e por quê. As regras de negócio estão em [regras-de-negocio.md](regras-de-negocio.md), o banco em [banco-de-dados.md](banco-de-dados.md) e o que existe e o que falta em [status.md](status.md).

## Visão geral

```
                 ┌─────────────── navegador ───────────────┐
                 │  bem-te-vi-web (React/Vite)             │
                 │  <sub>.APP_BASE_DOMAIN ou domínio próprio│
                 └───────────────┬─────────────────────────┘
                                 │ HTTPS + JWT (Authorization: Bearer)
                       [proxy/balanceador] ← TRUST_PROXY
                                 │
┌────────────────────────────────▼────────────────────────────────┐
│ NestJS (Express)                                                │
│  helmet → CORS → middlewares (RequestContext, RequestLogger)    │
│  guards globais: Throttler → JwtAuth → TenantAccess → Permissions│
│  ValidationPipe (whitelist + forbidNonWhitelisted)              │
│  módulos de domínio → serviços → Prisma                         │
└───────┬───────────────────────────────┬─────────────────────────┘
        │ Prisma (adapter pg)           │ SMTP (nodemailer)
   ┌────▼─────┐                   ┌─────▼──────┐     DNS (TXT)
   │PostgreSQL│                   │ provedor / │     verificação de
   │  15+     │                   │  Mailpit   │     domínio próprio
   └──────────┘                   └────────────┘
```

- **Stack:** Node.js 24, NestJS 12, TypeScript (ESM), Prisma 7 com `@prisma/adapter-pg`, PostgreSQL 15+, Vitest, oxlint.
- **Uma aplicação só (monolito modular):** um módulo Nest por domínio, todos no mesmo processo e no mesmo banco.
- **Multi-tenant em banco compartilhado:** toda entidade de negócio tem `tenantId`, e todo acesso filtra por ele. Row Level Security no Postgres fica como camada extra a considerar depois.

## Módulos (`src/`)

| Módulo | Responsabilidade |
|---|---|
| `auth` | Login (com restrição por host), JWT, `/auth/me`, troca/recuperação de senha, aceite de convite, aceite de termos. Guards globais e decorators (`@Public`, `@RequirePermissions`, `@CurrentUser`, `@TenantParam`) |
| `tenants` | Cadastro de clínica, dados e configurações, marca (whitelabel), logo, domínio próprio e verificação DNS, resolução de clínica por host, marca pública, exportação completa e encerramento de conta |
| `users` | Usuários da clínica, convite, redefinição de senha pelo admin, lista de profissionais |
| `roles` | Papéis e catálogo de permissões |
| `access` | `AccessPolicyService`: regras contra escalada de privilégio e garantia de pelo menos um admin |
| `patients` | Pacientes (busca, soft delete, restauração), fichas de anamnese, exportação do paciente |
| `anamnesis-templates` | Formulários de anamnese configuráveis e validação das respostas |
| `appointments` | Agenda: duração, conflito de horário, transições de status, escopo própria × todas |
| `billing` | Cobranças, pagamentos e resumo financeiro |
| `audit` | Trilha de auditoria (LGPD) e consulta |
| `legal` | Versões vigentes de Termos e Política e registro dos aceites |
| `account` | Tokens de uso único (recuperação de senha, convite) e montagem dos emails de conta |
| `mail` | `EmailSender` plugável; implementação SMTP |
| `platform` | Painel da plataforma: listar, suspender e excluir clínicas |
| `prisma` | `PrismaService` (pool `pg` com keepalive) |
| `common` | Paginação, filtro de erros do Prisma, middlewares, `RequestContext`, utilitários |

## Pipeline de uma requisição

1. **helmet** (cabeçalhos de segurança) e **CORS**.
2. **`RequestContextMiddleware`** guarda IP e navegador num `AsyncLocalStorage`, usado pela auditoria e pelos aceites de termos sem precisar passar esses dados por todas as camadas.
3. **`RequestLoggerMiddleware`** registra método, rota, status, duração e IP.
4. **Guards globais, nesta ordem:**
   1. `ThrottlerGuard`: 100 req/min por IP; 5/min nas rotas sensíveis (login, senha, convite); 10/min no cadastro de clínica.
   2. `JwtAuthGuard`: toda rota exige JWT, exceto as marcadas com `@Public()`.
   3. `TenantAccessGuard`: o `:tenantId` da URL precisa ser o do token (`403`). É o que isola as clínicas.
   4. `PermissionsGuard`: `@RequirePermissions(...)`. Todas as listadas são obrigatórias (E lógico).
5. **`ValidationPipe`** com `whitelist` + `forbidNonWhitelisted`: campo desconhecido → `400`.
6. **Controller → Service → Prisma.**
7. **`PrismaExceptionFilter`** traduz violação de unique em `409` (mensagem por índice), FK em `409` e registro não encontrado em `404`, em vez de `500`.

### Autenticação: o token só prova identidade

- O JWT leva `sub`, `tenantId`, `roleId`, `permissions` e `pwv` (versão da senha).
- **A cada requisição**, o `JwtStrategy` relê do banco o usuário, o status da clínica e as permissões do papel (uma consulta por chave primária). Desativar um usuário, suspender uma clínica ou mudar um papel vale na hora, sem esperar o token expirar.
- Trocar ou redefinir a senha incrementa `passwordVersion`, o que invalida todos os tokens antigos. A versão é um contador, e não uma data, porque o `iat` do JWT só tem precisão de segundos.
- Sem refresh token: o JWT dura `JWT_EXPIRES_IN` (padrão `1d`).

## Padrões de projeto usados

- **Escopo e isolamento nos serviços, não só nos guards.** As chaves estrangeiras garantem que o registro existe, não que é da mesma clínica. Os serviços conferem `tenantId` de paciente, profissional, formulário, agendamento e papel.
- **Concorrência com advisory locks do Postgres** (`pg_advisory_xact_lock`) dentro de transações:
  - **agenda:** por profissional, para impedir dois agendamentos sobrepostos;
  - **pagamentos:** por cobrança, para a soma nunca passar do valor;
  - **papéis e usuários:** por clínica, para a clínica nunca ficar sem administrador.
- **Peças plugáveis para o que é externo:** `DnsTxtResolver` (verificação de domínio) e `EmailSender` (SMTP). Nos testes, os dois são trocados por dublês.
- **Trabalho em segundo plano sem fila:** emails de recuperação, convite e encerramento são disparados sem esperar o SMTP. A falha fica no log. No "esqueci minha senha", isso também evita que o tempo de resposta revele se o email existe.
- **Auditoria síncrona e transacional:** nas escritas, o registro entra na mesma transação da alteração. Se a auditoria falhar, a requisição falha.
- **Tokens de uso único só como hash** (SHA-256) no banco, consumidos com `UPDATE` condicional, o que impede dois usos simultâneos do mesmo link.
- **Respostas com nomes relacionados:** agendamentos e cobranças trazem paciente e profissional, para o front não precisar de uma chamada por item.
- **Paginação padrão** (`{ data, meta: { total, page, pageSize, totalPages } }`) com ordenação estável (desempate por id).
- **Busca com SQL parametrizado** (`unaccent` + `ILIKE` por palavra) para os ids, e o Prisma para os registros.

## Segurança: resumo do que já está coberto

- Isolamento entre clínicas (guard + filtros nos serviços), com testes em todos os módulos.
- RBAC com permissões relidas a cada requisição; sem escalada de privilégio; sempre um admin ativo.
- Login sem enumeração de contas: mensagem única e tempo constante (bcrypt também quando o email não existe). Login restrito à clínica do endereço.
- Senhas com bcrypt (custo 12); sessões derrubadas na troca de senha.
- Domínio próprio só controla a marca depois de verificado por DNS. Links de email nunca usam o host do pedido (evita host header injection).
- Upload de logo: tipo detectado pelos bytes, SVG recusado, `nosniff`, limite de 1 MB.
- Rate limit, helmet, `TRUST_PROXY` para o IP real atrás de proxy.
- LGPD: trilha de auditoria imutável, aceite de termos, exportação por paciente e por clínica, encerramento com carência.

## Infraestrutura

- **Docker:** imagem multi-stage (`node:24-bookworm-slim`), usuário não-root, `HEALTHCHECK` em `GET /`, shutdown gracioso. Na subida, roda `prisma migrate deploy` e o seed (idempotente).
- **docker-compose:** `db` (Postgres 15) e `mailpit` sempre; `api` só com `--profile app`.
- **CI** (`.github/workflows/ci.yml`): `checks` (lint type-aware + typecheck), `unit`, `e2e` (Postgres de serviço) e `docker-smoke` (sobe a stack real e roda a coleção do Postman com newman).
- **Configuração:** só variáveis de ambiente. A lista comentada está em `.env.example`.

## Testes

- **Unitários** (`src/**/*.spec.ts`): regras puras (agenda, políticas de acesso, validação de anamnese, DNS), com o Prisma mockado.
- **E2E** (`test/*.e2e-spec.ts`): API inteira contra um Postgres real, com rate limit desligado, email e DNS trocados por dublês, e cada arquivo criando e apagando as próprias clínicas. Os testes de concorrência provam os advisory locks (falham quando o lock é removido).
- **Coleção do Postman** (`docs/api/`): roteiro de ponta a ponta contra a stack real, gerado por `build-collection.mjs`.
