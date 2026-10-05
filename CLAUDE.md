# CLAUDE.md — bem-te-vi-api

API de um SaaS whitelabel de gestão de clínicas (NestJS 12 + Prisma 7 + PostgreSQL 15, TypeScript ESM). O código, os comentários e os documentos são em **português**: mantenha o padrão.

**Antes de começar uma tarefa, leia [`docs/status.md`](docs/status.md)** (o que existe, o que falta e as decisões pendentes). Para detalhes:
- regras de negócio → [`docs/regras-de-negocio.md`](docs/regras-de-negocio.md)
- arquitetura → [`docs/arquitetura.md`](docs/arquitetura.md)
- banco → [`docs/banco-de-dados.md`](docs/banco-de-dados.md)
- contrato das rotas → `README.md`
- decisões de produto ainda sem resposta → `docs/decisoes/` (não implemente nada delas sem confirmar)

## Comandos

```bash
docker compose up -d                          # Postgres + Mailpit (emails em http://localhost:8025)
docker compose --profile app up -d --build    # + API em container (rebuild depois de mudar código)
npm run start:dev                             # API no host, com hot reload
npm run typecheck
npx oxlint src/ test/                         # lint local (o `npm run lint` type-aware pode não abrir no Windows; o CI roda o completo)
npm test                                      # unitários (sem banco)
npm run test:e2e                              # e2e contra o Postgres do .env (migrate + seed antes)
npx vitest run --config ./vitest.config.e2e.ts test/<arquivo>.e2e-spec.ts
npx prisma migrate dev --name <nome>          # migration (rode `npx prisma generate` se o client não atualizar)
npx prisma migrate dev --create-only --name <nome>   # migration só de dado, SQL à mão
npx prisma db seed                            # catálogo de permissões (idempotente)
node docs/api/build-collection.mjs            # regera a coleção do Postman (edite o script, nunca o JSON)
npx --yes newman@6.2.2 run docs/api/bem-te-vi.postman_collection.json -e docs/api/bem-te-vi.local.postman_environment.json --delay-request 150
```

## Arquitetura em resumo

- Um módulo Nest por domínio em `src/`: `tenants`, `users`, `roles`, `access`, `patients`, `anamnesis-templates`, `appointments`, `billing`, `audit`, `legal`, `account`, `mail` e `platform`. Banco via `PrismaService`.
- Rotas de negócio aninhadas em `/tenants/:tenantId/...`. Rotas públicas usam `@Public()`.
- Guards globais, nesta ordem: Throttler → JwtAuth → TenantAccess (o `:tenantId` da URL precisa ser o do token) → Permissions (`@RequirePermissions(...)`, com E lógico entre as permissões).
- O JWT só prova identidade: o `JwtStrategy` relê usuário, clínica e permissões **a cada requisição**. `passwordVersion` no token derruba as sessões na troca de senha.
- `ValidationPipe` com `whitelist` + `forbidNonWhitelisted`: campo extra → `400`. `PrismaExceptionFilter` mapeia unique/FK para `409` e registro não encontrado para `404`.
- Peças externas são plugáveis e trocadas por dublês nos testes: `DnsTxtResolver` e `EmailSender`.

## Invariantes — não quebre

1. **Isolamento entre clínicas.** Toda consulta filtra por `tenantId`. As FKs **não** garantem que o registro referenciado (paciente, profissional, formulário, papel, agendamento) é da mesma clínica: confira no serviço.
2. **Auditoria (LGPD).** Leitura e escrita de paciente e de ficha clínica passam por `AuditService.record`. Nas escritas, o registro entra **na mesma transação** da alteração. Conteúdo clínico nunca vai para `details`. `audit_logs` é imutável (trigger recusa `UPDATE`).
3. **Permissões:**
   - toda permissão nova entra no `prisma/seed.ts` **e** numa migration que a concede aos papéis existentes, para ninguém perder acesso no deploy;
   - "papel de administrador" = `users:manage` + `roles:manage` + `tenant:manage`;
   - **`platform:*` nunca** é concedida no cadastro público (`TenantsService.create`).
4. **Regras de conta** (`AccessPolicyService`): sem escalada de privilégio, e a clínica sempre mantém pelo menos um admin ativo.
5. **Concorrência:** agenda (sobreposição por profissional), pagamentos (saldo por cobrança) e admins (por clínica) usam `pg_advisory_xact_lock` dentro de transação. Não remova os locks: os testes de corrida dependem deles.
6. **Sem enumeração de contas:** login, "esqueci minha senha" e conflito de host respondem igual, inclusive no tempo de resposta.
7. **Links de email** apontam para o endereço da clínica (`AccountMailerService`), **nunca** para host ou `Origin` vindos do pedido.
8. **Nada de segredo em resposta ou exportação:** use `USER_SECRET_FIELDS` em todo `omit` de usuário. Nunca exponha `customDomainVerificationToken` nem `tokenHash`.

## Convenções

- Dinheiro em centavos (`amountCents`). CPF só com dígitos. Email sempre em minúsculas.
- "Excluir" é soft delete (paciente) ou cancelamento (agendamento, cobrança). Apagar de verdade só papel, formulário sem uso e clínica encerrada.
- Listas paginadas: `{ data, meta: { total, page, pageSize, totalPages } }`, com desempate por id na ordenação.
- Erros de formulário em rota autenticada (senha atual errada etc.) são `400`, **nunca `401`**: o front trata `401` como sessão inválida e desloga.
- Toda rota com `@CurrentUser()` recebe o ator no serviço como `actor: AuthenticatedUser`, logo depois do `tenantId`.
- Comentários explicam o **porquê** de uma regra. Siga a densidade e o tom do código ao redor.

## Ao terminar uma mudança

- [ ] Testes e2e cobrindo regra, permissões e isolamento entre clínicas (`test/helpers/e2e.ts` tem os helpers; o rótulo de `createUser` vira email, então não use espaço nele).
- [ ] `typecheck`, oxlint, unitários e e2e completos verdes. Um `read ECONNRESET` esporádico no setup em Docker no Windows é instabilidade conhecida.
- [ ] README (contrato da rota e lista de testes) e `docs/` atualizados, incluindo `docs/status.md`.
- [ ] Coleção do Postman verde contra a stack em Docker (roda no job `docker-smoke` do CI).
- [ ] Se mudar o contrato com o frontend (`bem-te-vi-web`, outro repositório): criar a task numerada em `docs/changes/` (fora do git), atualizar `docs/changes/00-indice.md` e o adendo da task `07`, e avisar quando a mudança quebra o front atual.
- [ ] Variável de ambiente nova: em `.env.example` (comentada) e no serviço `api` do `docker-compose.yml`.
