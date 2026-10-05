# Banco de dados

PostgreSQL 15+, acessado pelo Prisma 7 (`@prisma/adapter-pg`). **Fonte da verdade: `prisma/schema.prisma`.** Este documento explica o modelo e as decisões por trás dele.

## Convenções

- `id`: UUID gerado pela aplicação (`@default(uuid())`).
- **Multi-tenant em banco compartilhado:** toda entidade de negócio tem `tenantId`, e toda consulta filtra por ele.
- Colunas em `snake_case` no banco (`@map`), campos em `camelCase` no código.
- `createdAt`/`updatedAt` mantidos pelo Prisma.
- **Dinheiro em centavos** (`Int`): `amountCents`.
- **CPF só com dígitos** (11 caracteres).
- **Datas sem hora** (`@db.Date`): `birthDate` e `dueDate`.
- **Soft delete só em `Patient`** (`deletedAt`), por ser prontuário. Agendamento e cobrança são **cancelados**, não apagados.
- **JSON** onde a forma varia por clínica: `Patient.address`, `AnamnesisTemplate.fields`, `AnamnesisRecord.answers` e `AuditLog.details`.

## Diagrama (simplificado)

```
Tenant ─┬─ TenantBranding (1:1)        Permission (catálogo global)
        ├─ TenantLogo (1:1)                 │
        ├─ Role ──── RolePermission ────────┘
        │    └── User ─┬─ UserToken (convite / recuperação de senha)
        │              └─ LegalAcceptance (aceite de termos)
        ├─ Patient ─┬─ AnamnesisRecord ── AnamnesisTemplate (do tenant)
        │           ├─ Appointment ── User (profissional)
        │           └─ Charge ── Payment
        │                 └── Appointment (opcional, do mesmo paciente)
        └─ AuditLog (sem FK para usuário/paciente)

TenantDeletion (sem FK nenhuma: sobra depois da exclusão da clínica)
```

## Tabelas

### Clínica e acesso

| Modelo (tabela) | Para que serve | Pontos importantes |
|---|---|---|
| `Tenant` (`tenants`) | A clínica | `subdomain` único; `customDomain` único, com token e data de verificação DNS; `status` (`active`/`suspended`); `isPlatform` (a clínica que hospeda o painel da plataforma); durações padrão e mínima de atendimento; `closureRequestedAt` (pedido de encerramento) |
| `TenantBranding` (`tenant_branding`) | Marca: nome fantasia, logo (URL) e cores | 1:1 com a clínica |
| `TenantLogo` (`tenant_logos`) | Bytes do logo enviado por upload | Separado da marca para os bytes não virem em toda leitura; o `id` muda a cada upload (URL imutável) |
| `TenantDeletion` (`tenant_deletions`) | Prova de exclusão de uma clínica | **Sem FK:** é o único registro que sobra depois da exclusão |
| `User` (`users`) | Usuário de uma clínica | **Email único em toda a plataforma**, sempre em minúsculas; `status` (`active`/`invited`/`disabled`); `passwordVersion` (invalida tokens antigos); duração própria de atendimento |
| `Role` (`roles`) | Papel da clínica | Nome único por clínica |
| `Permission` (`permissions`) | Catálogo **global** de permissões (14 chaves) | Populado pelo seed e por migrations |
| `RolePermission` (`role_permissions`) | Permissões de cada papel | Chave composta |
| `UserToken` (`user_tokens`) | Links de uso único (`password_reset`, `invite`) | Só o hash SHA-256; `expiresAt`, `usedAt` |
| `LegalAcceptance` (`legal_acceptances`) | Aceite de Termos (`terms`) e Política (`privacy`) | Uma linha por aceite, nunca sobrescrita; versão, IP e navegador |

### Pacientes e prontuário

| Modelo | Para que serve | Pontos importantes |
|---|---|---|
| `Patient` (`patients`) | Cadastro do paciente | `@@unique([tenantId, cpf])`, **inclusive entre removidos**; `deletedAt` (soft delete); `address` em JSON livre |
| `AnamnesisTemplate` (`anamnesis_templates`) | Formulário de anamnese configurado pela clínica | Nome único por clínica; `fields` em JSON (chave, rótulo, tipo, obrigatório, opções), validado na escrita |
| `AnamnesisRecord` (`anamnesis_records`) | Ficha preenchida | **Imutável** (não há rota de edição); `answers` validado contra o formulário no momento do registro; FK `Restrict` para o formulário e para quem preencheu |

### Agenda e financeiro

| Modelo | Para que serve | Pontos importantes |
|---|---|---|
| `Appointment` (`appointments`) | Agendamento | `scheduledAt`/`endsAt`; `status` (`scheduled`, `confirmed`, `completed`, `cancelled`, `no_show`); índices `(tenantId, scheduledAt)` e `(professionalId, scheduledAt)` |
| `Charge` (`charges`) | Cobrança de um paciente | `amountCents`; `dueDate`; `status` (`pending`, `paid`, `cancelled`). "Atrasada" é calculado, não guardado; `appointmentId` opcional (`SetNull`) |
| `Payment` (`payments`) | Pagamento (parcial ou total) | `method` (`cash`, `pix`, `credit_card`, `debit_card`, `bank_transfer`, `other`); a soma nunca passa da cobrança |

### LGPD

| Modelo | Para que serve | Pontos importantes |
|---|---|---|
| `AuditLog` (`audit_logs`) | Trilha de auditoria de acesso a dado de paciente | **Imutável:** trigger `audit_logs_no_update` recusa `UPDATE`. Sem FK para usuário nem paciente (sobrevive a eles), só `tenantId` com cascata. Índices por clínica + data, paciente e usuário |

## Regras de integridade que valem a pena saber

- **FKs `Restrict`** de propósito, para impedir apagar dado que é referência histórica:
  - `User → Role`: papel em uso não pode ser apagado (`409`);
  - ficha → formulário: formulário usado não pode ser apagado (`409`);
  - ficha, agendamento, cobrança e pagamento → usuário: autor e profissional precisam continuar existindo.
- Por causa desses `Restrict`, **apagar uma clínica exige uma ordem**: fichas → formulários → cobranças (pagamentos em cascata) → agendamentos → pacientes → usuários → clínica. Essa ordem está em `PlatformService.deleteTenant` e no helper dos testes (`cleanupTenants`).
- As **FKs não garantem que o registro é da mesma clínica**: essa checagem é dos serviços.
- **O que vai em cascata:** `UserToken` e `LegalAcceptance` com o usuário; `TenantBranding`, `TenantLogo`, `Role` e `AuditLog` com a clínica; `Payment` com a cobrança.

## Extensões e SQL fora do Prisma

- **`unaccent`** (migration `patient_search`): usada na busca de pacientes e de clínicas. É uma extensão *trusted*: basta o usuário do banco ter `CREATE` no banco.
- **Trigger de imutabilidade** da auditoria (migration `audit_log`).
- **Advisory locks** (`pg_advisory_xact_lock(hashtext(...))`) em transações: agenda (por profissional), pagamento (por cobrança) e administradores (por clínica).
- **SQL parametrizado** (`$queryRaw`) na busca de pacientes e de clínicas, só para achar os ids da página.

## Migrations (em ordem)

| Migration | O que fez |
|---|---|
| `init` | Esquema inicial: clínicas, marca, usuários, papéis, permissões, pacientes, anamnese, agenda |
| `patient_search` | Extensão `unaccent` para a busca |
| `appointments_pagination_index` | Índice `(tenant_id, scheduled_at)` |
| `custom_domain_verification` | Token e data de verificação do domínio próprio |
| `anamnesis_templates` | Formulários de anamnese; a ficha passa a apontar para um formulário |
| `platform_backoffice` | `is_platform` na clínica |
| `billing` | Cobranças e pagamentos |
| `password_version` | `users.password_version` (derrubar sessões na troca de senha) |
| `appointments_all_scope` | Permissão `appointments:all`, dada a todo papel que tinha `appointments:read` (preserva o acesso) |
| `email_tokens_and_logo_upload` | `user_tokens` e `tenant_logos` |
| `audit_log` | `audit_logs`, trigger de imutabilidade e permissão `audit:read` (só para papéis de administrador) |
| `legal_acceptances` | `legal_acceptances` |
| `patients_export_permission` | Permissão `patients:export` (só para papéis de administrador) |
| `tenant_closure` | `closure_requested_at` na clínica e `tenant_deletions` |

**Migrations com dado:** as que criam permissões também as concedem a papéis já existentes, para ninguém perder acesso no deploy. "Papel de administrador" = papel com `users:manage` + `roles:manage` + `tenant:manage`, a mesma definição do `AccessPolicyService`.

## Comandos

```bash
npx prisma migrate dev --name <nome>   # nova migration em dev (aplica e gera o client)
npx prisma migrate dev --create-only   # cria vazia, para migration só de dado (SQL à mão)
npx prisma generate                    # regera o client (o Prisma 7 não regera sozinho em todo caso)
npx prisma migrate deploy              # produção / CI (não interativo)
npx prisma db seed                     # catálogo de permissões (idempotente)
npm run bootstrap:platform             # clínica-plataforma + primeiro admin do painel
```
