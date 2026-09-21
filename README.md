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

## Autenticação e autorização (`src/auth`)

- Login: `POST /auth/login` com `{ email, password }` → retorna um JWT (`accessToken`) contendo `tenantId`, `roleId` e as `permissions` (chaves do catálogo de `Permission`) do usuário.
- Toda rota é protegida por padrão (`JwtAuthGuard` global). Para deixar uma rota pública, use `@Public()`.
- `TenantAccessGuard` bloqueia (403) qualquer request cujo `:tenantId` da URL não bata com o `tenantId` do token — impede um usuário de um tenant acessar dados de outro só trocando a URL.
- `PermissionsGuard` + `@RequirePermissions('patients:write')` etc. checam as permissões do token contra as exigidas pela rota.
- `@CurrentUser()` injeta `{ userId, tenantId, roleId, permissions }` no handler.
- Rate limit global de 100 req/min por IP (`@nestjs/throttler`), com limite mais agressivo (5 req/min) em `POST /auth/login` contra força bruta.
- `helmet` aplica cabeçalhos de segurança padrão (CSP, HSTS, etc.) em todas as respostas.
- `RequestLoggerMiddleware` loga método/rota/status/duração/IP de cada request (auditoria básica).

**Limitação conhecida:** as permissões ficam "congeladas" no token no momento do login — mudar o papel/permissões de um usuário só tem efeito no próximo login dele. Aceitável para o MVP; token de curta duração (`JWT_EXPIRES_IN`) mitiga.
