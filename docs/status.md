# Status atual da aplicação

*Atualizado em 14/10/2026.* Retrato do MVP da API: o que está pronto, o que está em andamento e o que falta. Ponto de partida para uma sessão nova de desenvolvimento.

## Resumo

A **API do MVP está funcionalmente completa** (clínica, acesso, pacientes, anamnese, agenda, financeiro, painel da plataforma), a **seção de LGPD foi implementada** e a **revisão de segurança para produção (task 19) foi feita**. O que falta para lançar é infraestrutura de produção, algumas decisões de produto e a implementação das tasks correspondentes no frontend.

**Indicadores (última rodada local):**
- 99 testes unitários e 535 e2e passando.
- Coleção do Postman: 95 requisições e 152 asserções verdes contra a stack em Docker.
- `audit-ci` (dependências de produção) e gitleaks (histórico do git) limpos.
- Typecheck e oxlint limpos.

## Pronto na API

| Área | O que existe |
|---|---|
| Clínica | Cadastro público com aceite de termos e validação completa (texto obrigatório, subdomínio DNS válido e não reservado, domínio próprio fora do domínio da plataforma); configurações de duração; suspensão pela plataforma |
| Configurações de tela | Layout da tela inicial por clínica (`/configs`), editado por quem tem `tenant:manage`, lido por todos |
| Whitelabel | Marca, upload de logo, domínio próprio com verificação DNS, marca pública por host, login restrito ao endereço |
| Acesso | Login (tempo constante, sem enumeração, bloqueio por conta depois de 10 senhas erradas), sessões com token de acesso de 15 min + refresh rotativo em cookie `HttpOnly` + logout que vale na hora, JWT com estado relido a cada requisição, RBAC com 15 permissões, sem escalada de privilégio, sempre um admin, convite por email, troca, redefinição e recuperação de senha |
| Pacientes | CRUD, CPF único (inclusive removidos), soft delete e restauração, busca sem acento por nome, CPF ou telefone |
| Anamnese | Formulários configuráveis, fichas validadas e imutáveis |
| Agenda | Duração por profissional ou clínica, sem sobreposição (com lock), transições de status, janela por sobreposição, escopo própria × todas, profissional = quem tem `appointments:attend` |
| Financeiro | Cobranças, pagamentos parciais (com lock), atraso calculado, resumo |
| Painel da plataforma | Listar e buscar (com filtro de encerramento pedido ou pronto para excluir), suspender e reativar, excluir clínica encerrada |
| LGPD | Trilha de auditoria imutável; aceite de Termos e Política; exportação do paciente; exportação completa e encerramento de conta |
| Validação | Erros em português em toda a API, com `errors: [{ field, code, message }]` |
| Operação | Docker (API + Postgres + Mailpit), CI com 5 jobs (inclui auditoria de dependências e varredura de segredos), CORS fechado, recusa de segredo fraco em produção, logs sem dado sensível, `TRUST_PROXY`, rate limit, helmet |

## Tasks entre API e front

**Convenção desde 10/10/2026** (as duas pastas ficam fora do git, e a numeração é uma só nos dois repositórios):
- pedidos do front para a **API** → `docs/changes/` deste repositório, com o índice `docs/changes/00-indice.md` (coluna "Situação na API");
- tasks para o **front** → `../bem-te-vi-web/docs/changes/`, com o índice de lá.

Antes de criar uma task, veja o maior número nos dois índices.

### Pedidos do front para a API (`docs/changes/`)

| Task | Assunto | Prioridade | Situação |
|---|---|---|---|
| 12 | Busca de pacientes também pelo telefone | Média | ✅ Feita em 14/10/2026 (front: só textos de ajuda, ver índice) |
| 13 | Permissão `appointments:attend` (quem atende pacientes) | Média; corrige regra que aparece errada nas telas | ✅ Feita em 14/10/2026 (front: task 23) |
| 14 | Validação do cadastro de clínica antes da landing | Alta (antes de abrir para clientes) | ✅ Feita em 14/10/2026 (front: task 22) |
| 15 | Links de email com subdomínio em dev (`*.localhost`) | Baixa | ✅ Feita em 14/10/2026 (front: task 27) |
| 16 | Nome do paciente nos registros da auditoria | Média | ✅ Feita em 14/10/2026 (front: task 24) |
| 17 | Encerramentos pedidos no painel da plataforma | Média | ✅ Feita em 14/10/2026 (front: task 25) |
| 18 | Configurações de tela (`/configs`), começando pelo layout da tela inicial | Média | ✅ Feita em 14/10/2026 (front: task 26) |
| 19 | Revisão de segurança antes de produção (par da task 20 do front) | Alta (antes de produção) | ✅ Feita em 14/10/2026 (front: task 21) |

A situação detalhada fica no índice. Todos os pedidos do front até aqui (12 a 19) estão feitos na API.

**Revisão de segurança (task 19), registrada em 14/10/2026:**
- **CORS** fechado (`CorsOriginPolicy`): domínio base e subdomínios, domínios próprios verificados, `CORS_EXTRA_ORIGINS` e localhost fora de produção.
- **Segredo:** em produção, a API não sobe com `JWT_SECRET` de exemplo ou com menos de 32 caracteres.
- **Sessão:** token de acesso de 15 min, refresh rotativo em cookie `HttpOnly` + `SameSite=Strict`, `POST /auth/refresh` e `POST /auth/logout`. Decisão registrada em `docs/decisoes/07-sessao-e-token.md`.
- **Login:** bloqueio por conta depois de 10 senhas erradas em 15 min, auditado.
- **CI:** `audit-ci` (falha em vulnerabilidade alta ou crítica; exceções do CLI do Prisma explicadas em `audit-ci.jsonc`) e gitleaks no histórico.
- **Logs:** sem query string (a busca leva nome, CPF e telefone de paciente), corpo ou headers. Erros `500` não devolvem stack (padrão do Nest).
- **Achado à parte:** sem `SMTP_HOST`, o `EmailSender` grava o email inteiro no log, inclusive o link de redefinição de senha com o token. É o modo de dev; em produção, `SMTP_HOST` precisa estar definido.

### Tasks para o front

Em `../bem-te-vi-web/docs/changes/`: a 20 (segurança do front, par da 19), a 21 (sessão: token em memória, refresh e logout, ⚠️ **o front atual perde a sessão a cada 15 minutos até ela ser feita**) a 22 (formato novo dos erros de validação e regras do cadastro) a 23 (`appointments:attend`: duração só para quem atende, rótulo em Papéis) a 24 (nome do paciente na tela de Auditoria) a 25 (filtro de encerramentos no painel da plataforma), a 26 (ligar o salvar do editor da tela inicial) e a 27 (remover o modo `?tenant=` em dev). As tasks 01 a 11 foram escritas aqui, antes da convenção, e entregues ao front; a situação delas é desconhecida deste lado:

| Task | Assunto | Observação |
|---|---|---|
| 01 | Enviar o `host` no login | |
| 02 | Agenda própria × todas | Corrige comportamento errado |
| 03–04 | Esqueci minha senha / redefinir senha | Rota fixa `/reset-password` |
| 05 | Convite por email | Rota fixa `/accept-invite` |
| 06 | Upload de logo | |
| 07 | Atualizar o `regras-de-negocio.md` do front | Tem adendos das tasks 08–11 |
| 08 | Trilha de auditoria | |
| 09 | Aceite de termos | ⚠️ **Quebra o cadastro e o aceite de convite atuais** (`400`) até ser implementada |
| 10 | Exportar dados do paciente | |
| 11 | Encerramento de conta | |

## Decisões de produto

**Decidida:** 7. **Sessão e token** (14/10/2026): token de acesso de 15 min em memória, refresh rotativo em cookie `HttpOnly`, logout no servidor. Ver `docs/decisoes/07-sessao-e-token.md`.

**Pendentes:**

Analisadas em `docs/decisoes/`, cada uma com opções e recomendação, aguardando resposta:

1. **Escopo do médico sobre pacientes e prontuário.** Hoje quem tem `patients:read` vê todo prontuário. Recomendação: separar dado cadastral de dado clínico.
2. **Evolução clínica por consulta.** Recomendação: generalizar a anamnese em "registro clínico" ligado ao agendamento, com adendo. Junto: travar `Appointment.notes` depois de o atendimento ser encerrado (hoje é editável sem histórico).
3. **Horários de atendimento.** Recomendação: grade semanal que só avisa. **Pré-requisito: fuso horário da clínica, que não existe (tudo é UTC).**
4. **Lembrete de consulta.** Recomendação: email com link para confirmar. **Pré-requisitos:** fuso da clínica e um agendador de tarefas.
5. **Cobrança das clínicas pela plataforma.** Recomendação: manual no começo.
6. **Confirmação de email no cadastro.** Recomendação: confirmar antes do primeiro login.

## Falta para lançar

**Infraestrutura (bloqueia o lançamento):**
- Hospedagem, banco gerenciado e domínio do produto (`APP_BASE_DOMAIN`).
- DNS e certificado coringa para os subdomínios.
- **HTTPS para domínios próprios das clínicas.** A API verifica a posse, mas não há nada que sirva o front com certificado nesses domínios. Exige emissão sob demanda (Caddy on-demand TLS, Cloudflare for SaaS ou similar).
- **API servida também no domínio próprio de cada clínica** (proxy, ex.: `agenda.clinica.com.br/api`). Sem isso, o cookie de sessão é de terceiro nesses domínios, o navegador pode bloqueá-lo, e o usuário perde a sessão a cada 15 minutos. Cabe na mesma peça do item acima. Ver `docs/decisoes/07-sessao-e-token.md`.
- `SMTP_HOST` definido em produção (sem ele, os emails, com os links de senha, vão para o log).
- `CORS_EXTRA_ORIGINS` com a origem da landing, se ela ficar fora do `APP_BASE_DOMAIN`.
- Provedor SMTP real, com SPF e DKIM.
- Backup do banco com teste de restauração.
- Monitoramento: captura de erros e logs persistidos.
- Configurar `TRUST_PROXY` atrás do proxy.
- Com mais de uma réplica, rodar migrate e seed como passo único de release.

**Jurídico (precisa de advogado):**
- Textos dos Termos de Uso e da Política de Privacidade. A API só controla versões.
- Prazos de guarda de prontuário depois que a clínica sai, e a carência de 30 dias.
- Quando atender pedido de eliminação ou anonimização de paciente (não implementado de propósito).
- Exigências do CFM para prontuário eletrônico (assinatura digital, por exemplo; fora do MVP).

## Limitações conhecidas

- Mesmo email não pode estar em duas clínicas (email único global).
- Sessão de no máximo 24 h desde o login, mesmo em uso contínuo (o teto de 1 dia de antes). Sem lista de sessões ativas nem "sair de todos os dispositivos" (o modelo já guarda IP, navegador e último uso).
- O bloqueio por tentativas pode ser usado para travar a conta de outra pessoa por 15 minutos (sabendo só o email). É o preço de não deixar adivinhar a senha por muitos IPs; a vítima pode redefinir a senha pelo email, o que também tira o bloqueio.
- Sem busca em usuários, papéis e agenda; a agenda não filtra por vários profissionais de uma vez.
- "Hoje" (atraso de cobrança) é calculado em UTC.
- Agenda e financeiro não entram na trilha de auditoria. A trilha não tem política de retenção (fica enquanto a clínica existir).
- Exportação completa da clínica é montada em memória: serve ao MVP; com bases grandes, vira assíncrona.
- Busca de pacientes sem índice de trigram: suficiente para milhares de cadastros por clínica.
- Emails em segundo plano sem fila: se o processo cair no meio do envio, o email se perde (o convite pode ser reenviado, a recuperação pedida de novo).
- `npm run lint` (modo type-aware) não roda em algumas máquinas Windows: o executável `tsgolint` falha ao abrir. O `npx oxlint src/ test/` funciona, e o CI roda o completo.
- Os testes e2e podem falhar esporadicamente com `read ECONNRESET` no setup em Docker no Windows. O CI reexecuta o e2e uma vez.

## Documentação

| Arquivo | Conteúdo |
|---|---|
| `CLAUDE.md` | Instruções para sessões do Claude Code: comandos, invariantes, convenções e checklist de entrega |
| `README.md` | Como rodar e contrato da API, por domínio |
| `docs/arquitetura.md` | Módulos, pipeline da requisição, padrões, segurança, infraestrutura |
| `docs/banco-de-dados.md` | Modelo, integridade, SQL fora do Prisma, migrations |
| `docs/regras-de-negocio.md` | Regras por domínio |
| `docs/status.md` | Este arquivo |
| `docs/decisoes/` | Decisões de produto (pendentes e decididas), com análise |
| `docs/changes/` | Pedidos do front para a API (fora do git); tasks para o front ficam em `../bem-te-vi-web/docs/changes/` |
| `docs/api/` | Coleção do Postman e o gerador dela |
