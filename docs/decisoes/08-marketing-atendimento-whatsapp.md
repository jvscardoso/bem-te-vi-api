# 08 · Marketing, etapa 1: atendimento automatizado por WhatsApp

> ⏸️ **Em espera desde 14/10/2026.** O lançamento vem antes (a última peça crucial é o pagamento da mensalidade, task 29). O que foi decidido sobre a automação do WhatsApp está consolidado na **task 30** (`docs/changes/30-atendimento-whatsapp-fase-1.md`), para retomar sem refazer a análise. A fase 0 (fuso, telefone normalizado, consentimento e fila) já foi feita.

**Situação:** em decisão. Parte já decidida em 14/10/2026 (ver "Decidido"); faltam os pontos de "Perguntas para você".
**Esforço:** G (infraestrutura nova, integração externa, construtor de fluxos)
**Relação com outras decisões:** substitui a opção D da decisão 04 (lembrete de consulta) e precisa do fuso da clínica, que é a primeira parte da decisão 03 (horários de atendimento).

## O pedido

Cada clínica cadastra o próprio número de WhatsApp e tem um atendimento automatizado para **marcar, confirmar e cancelar consultas**. Seguindo o whitelabel, a clínica configura o **fluxo** e os **textos** das mensagens. Tudo sob permissões com o prefixo `marketing:`.

## Decidido (14/10/2026)

| Ponto | Decisão |
|---|---|
| Conexão com o WhatsApp | **API oficial.** Nada de solução não oficial (o número seria banido). Foi decidido "por um provedor parceiro (BSP)", mas a comparação da **decisão 10** recomenda **Meta direto**: o registro como *Tech Provider* da Meta é exigido em qualquer caminho, e o provedor só acrescenta custo. Aguardando confirmação |
| Por onde começar | **Lembrete + confirmação/cancelamento.** O agendamento pelo bot vem depois |
| Configuração do fluxo | **Construtor de fluxos:** a clínica monta o fluxo em etapas ligadas entre si, não só edita textos de um fluxo fixo |
| Fila e agendador | **pg-boss, no próprio Postgres.** Nenhum serviço novo para hospedar |

## Regras da API oficial do WhatsApp que moldam o desenho

1. **Mensagem iniciada pela clínica** (lembrete, campanha) só sai por **modelo aprovado pela Meta** (template). A clínica pode escrever os próprios modelos, mas cada um passa por aprovação (minutos a horas) e pode ser recusado. As telas precisam mostrar "em análise / aprovado / recusado".
2. **Até 24 h depois da última mensagem do paciente**, a clínica responde com texto livre, botões e listas. É nessa janela que o fluxo roda.
3. **Cobrança por mensagem enviada pela clínica** (desde julho de 2025), com preços diferentes para "utilidade" (lembrete, R$ 0,035) e "marketing" (campanha, R$ 0,32). **Desde 1º/10/2026, as respostas dentro da janela de 24 h também são cobradas** (R$ 0,035 cada): cada mensagem que o fluxo manda custa. Um fluxo enxuto (poucas mensagens até resolver) é também um fluxo mais barato. Detalhes e fontes na decisão 10.
4. **Opt-in:** a política da Meta exige que o paciente tenha aceitado receber mensagens da clínica por WhatsApp.

Na prática, o lembrete é um **modelo aprovado** com dois botões ("Confirmar", "Preciso desmarcar"). O toque num botão abre a janela de 24 h, e daí em diante quem conduz a conversa é o **fluxo** da clínica.

## Desenho proposto

### Provedor plugável

Mesmo padrão do `EmailSender` e do `DnsTxtResolver`: uma interface `WhatsAppProvider` (enviar texto, botões, lista e modelo; cadastrar modelo; ler status) com uma implementação para o BSP escolhido e um dublê nos testes. Trocar de provedor, ou ir direto para a Meta no futuro, é escrever outra implementação.

### Conexão do número (por clínica)

- A clínica conecta o número pelo processo do BSP (cadastro guiado), e a API guarda o identificador do número e as credenciais.
- **Credenciais criptografadas no banco** (chave em variável de ambiente) e **nunca devolvidas** em resposta, exportação ou log. Vira um invariante novo, como o `USER_SECRET_FIELDS`.
- **Webhook público** para as mensagens recebidas e os status (enviada, entregue, lida, falhou), com **assinatura conferida** e a clínica identificada pelo número que recebeu, **nunca** por algo que o remetente informe.

### Construtor de fluxos

O fluxo é um **grafo de etapas** salvo como JSON e validado pela API (mesma ideia do formulário de anamnese: a clínica monta, a API garante a forma). Tipos de etapa sugeridos para a primeira versão:

| Etapa | O que faz |
|---|---|
| `message` | Envia um texto (com variáveis: `{{paciente.nome}}`, `{{consulta.data}}`, `{{clinica.nome}}`...) e segue |
| `buttons` | Envia até 3 botões; cada botão leva a uma etapa |
| `list` | Envia uma lista de opções (até 10); cada opção leva a uma etapa |
| `confirm_appointment` / `cancel_appointment` | Ação na agenda (consulta da conversa), com saída "deu certo" e "não deu" |
| `handoff` | Passa para a recepção (marca a conversa como "precisa de atendimento") |
| `end` | Encerra |

- Uma etapa de **entrada** por gatilho: "paciente respondeu ao lembrete" e "paciente escreveu sem contexto". O fluxo de agendamento entra na fase 3 como outro gatilho e novas etapas (escolher profissional, escolher horário).
- **Validação:** toda saída aponta para uma etapa que existe, não há etapa solta, limite de etapas e de tamanho de texto, e não há laço sem saída.
- **Versões:** salvar cria uma versão nova; a conversa em andamento termina na versão em que começou.
- **Padrão pronto:** a clínica nasce com um fluxo padrão de confirmação/cancelamento, para funcionar sem configurar nada.
- **Mensagem fora do fluxo:** se o paciente escrever algo que o fluxo não espera, o bot repete as opções. Na segunda vez, passa para a recepção.

### Lembrete (fase 1)

- **Job do pg-boss** que, a cada poucos minutos, acha as consultas que entram na antecedência configurada (padrão 24 h) e enfileira um lembrete por consulta. O envio é idempotente: a mesma consulta nunca recebe dois lembretes, mesmo com várias réplicas da API.
- **Confirmar** muda a consulta para `confirmed`. **Cancelar** muda para `cancelled` e avisa a clínica. É a recomendação da decisão 04, aqui como etapas do fluxo padrão, que a clínica pode trocar.
- Na agenda, aparece "confirmado pelo paciente".

### Dados novos (resumo)

- `Tenant.timezone` (fuso IANA, padrão `America/Sao_Paulo`): pré-requisito.
- Telefone do paciente **normalizado** (dígitos, formato internacional) para achar o paciente pelo número que escreveu. Hoje o telefone é texto livre.
- Consentimento do paciente para WhatsApp (com data e origem) e opt-out ("SAIR").
- Conexão do WhatsApp da clínica, modelos de mensagem (com status de aprovação), fluxos (com versões), conversas e mensagens (com status), e o registro do lembrete enviado na consulta.

### Permissões

| Permissão | Libera |
|---|---|
| `marketing:whatsapp` | Conectar o número, editar fluxos e modelos, ligar ou desligar o lembrete |
| `marketing:conversations` | Ver as conversas e assumir as que foram passadas para a recepção |
| `marketing:campaigns` / `marketing:send` | Etapa 2 (decisão 09) |

Como sempre: no seed e numa migration que as concede aos papéis de administrador, e nunca `platform:*`.

### LGPD e auditoria

- Conversas são dado pessoal e podem ter dado de saúde ("estou com dor"). Leitura de conversa entra na trilha de auditoria, como a do paciente.
- **Prazo de guarda** das conversas: decisão jurídica.
- A Meta e o BSP entram na Política de Privacidade como **operadores**.

## Fases

| Fase | Entrega | Depende de |
|---|---|---|
| 0 | ✅ **Feita (14/10/2026).** Fuso da clínica, telefone normalizado (`phoneE164`), consentimento do paciente (WhatsApp e marketing, com histórico; o "SAIR" pelo WhatsApp entra na fase 1 como `source: patient`), pg-boss (`JobQueue`) | — |
| 1 | Conexão do número, provedor plugável, webhook, modelos, construtor de fluxos com as etapas acima, lembrete com confirmação e cancelamento, fluxo padrão | Provedor escolhido (decisão 10) e registro como *Tech Provider* da Meta em andamento |
| 2 | "Falar com a recepção": caixa de entrada das conversas passadas para uma pessoa, responder pela tela | Fase 1 |
| 3 | Agendamento pelo bot: escolher profissional e horário livre | Horários de atendimento (decisão 03, opção B) |

## Perguntas para você

- [ ] **Qual provedor?** Comparação feita na **decisão 10** (Meta direto, Twilio, 360dialog, Gupshup, Zenvia). Recomendação: **Meta direto**.
- [x] **Quem paga as conversas:** a **plataforma**. Lembretes e agendamentos pelo bot estão incluídos nos planos, com franquia e limite (decisão 11).
- [ ] **Antecedência do lembrete:** padrão de 24 h, configurável por clínica? (Recomendo sim.)
- [ ] **Opt-in:** como a clínica registra o aceite do paciente? Sugestão: uma caixa "aceita receber mensagens por WhatsApp" no cadastro do paciente, com data, e o "SAIR" respeitado sempre.
- [ ] **Jurídico:** prazo de guarda das conversas e atualização da Política de Privacidade.
