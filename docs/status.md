# Status atual da aplicação

*Atualizado em 05/10/2026.* Retrato do MVP da API: o que está pronto, o que está em andamento e o que falta. Ponto de partida para uma sessão nova de desenvolvimento.

## Resumo

A **API do MVP está funcionalmente completa** (clínica, acesso, pacientes, anamnese, agenda, financeiro, painel da plataforma) e a **seção de LGPD foi implementada**. O que falta para lançar é infraestrutura de produção, algumas decisões de produto e a implementação das tasks correspondentes no frontend.

**Indicadores (última rodada local):**
- 90 testes unitários e 438 e2e passando.
- Coleção do Postman: 83 requisições e 128 asserções verdes contra a stack em Docker.
- Typecheck e oxlint limpos.

## Pronto na API

| Área | O que existe |
|---|---|
| Clínica | Cadastro público com aceite de termos; configurações de duração; suspensão pela plataforma |
| Whitelabel | Marca, upload de logo, domínio próprio com verificação DNS, marca pública por host, login restrito ao endereço |
| Acesso | Login (tempo constante, sem enumeração), JWT com estado relido a cada requisição, RBAC com 14 permissões, sem escalada de privilégio, sempre um admin, convite por email, troca, redefinição e recuperação de senha |
| Pacientes | CRUD, CPF único (inclusive removidos), soft delete e restauração, busca sem acento por nome ou CPF |
| Anamnese | Formulários configuráveis, fichas validadas e imutáveis |
| Agenda | Duração por profissional ou clínica, sem sobreposição (com lock), transições de status, janela por sobreposição, escopo própria × todas |
| Financeiro | Cobranças, pagamentos parciais (com lock), atraso calculado, resumo |
| Painel da plataforma | Listar e buscar, suspender e reativar, excluir clínica encerrada |
| LGPD | Trilha de auditoria imutável; aceite de Termos e Política; exportação do paciente; exportação completa e encerramento de conta |
| Operação | Docker (API + Postgres + Mailpit), CI com 4 jobs, `TRUST_PROXY`, rate limit, helmet |

## Frontend (`bem-te-vi-web`)

As tasks para o front estão em `docs/changes/` (pasta fora do git, enviada ao repositório do front). A situação de cada uma é desconhecida deste lado. Esta é a lista entregue:

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

## Decisões de produto pendentes

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
- Sem refresh token; a sessão dura `JWT_EXPIRES_IN`.
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
| `README.md` | Como rodar e contrato da API, por domínio |
| `docs/arquitetura.md` | Módulos, pipeline da requisição, padrões, segurança, infraestrutura |
| `docs/banco-de-dados.md` | Modelo, integridade, SQL fora do Prisma, migrations |
| `docs/regras-de-negocio.md` | Regras por domínio |
| `docs/status.md` | Este arquivo |
| `docs/decisoes/` | Decisões de produto pendentes, com análise |
| `docs/changes/` | Tasks para o frontend (fora do git) |
| `docs/api/` | Coleção do Postman e o gerador dela |
