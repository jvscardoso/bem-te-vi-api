# Decisões de produto pendentes — índice

Pontos do MVP que dependem de uma decisão antes de implementar. Cada arquivo traz o comportamento atual, as opções com prós e contras, uma recomendação, o impacto e as perguntas a responder.

O **esforço** é relativo: **P** (pequeno: um endpoint ou um ajuste de regra), **M** (médio: modelo novo + algumas rotas + testes) e **G** (grande: infraestrutura nova ou integração externa).

| # | Decisão | Recomendação resumida | Esforço |
|---|---|---|---|
| 01 | [Escopo do médico sobre pacientes e prontuário](01-escopo-do-medico-sobre-pacientes.md) | Separar dado cadastral de dado clínico; clínico restrito a quem atende o paciente | M |
| 02 | [Evolução clínica](02-evolucao-clinica.md) | Generalizar a anamnese em "registro clínico" ligado à consulta, imutável | P–M |
| 03 | [Horários de atendimento](03-horarios-de-atendimento.md) | Grade semanal por profissional, só como aviso, depois de criar o fuso da clínica | M |
| 04 | [Lembrete de consulta](04-lembrete-de-consulta.md) | Email 24h antes, com link para confirmar ou cancelar | M |
| 05 | [Cobrança das clínicas pela plataforma](05-cobranca-das-clinicas.md) | Manual no começo; plano e período de teste no banco quando houver mais clientes | P → M |
| 06 | [Confirmação de email no cadastro](06-confirmacao-de-email-no-cadastro.md) | Confirmar o email do dono antes do primeiro login | P |
| 08 | [Marketing, etapa 1: atendimento por WhatsApp](08-marketing-atendimento-whatsapp.md) | ⏸️ **Em espera** (task 30). **Parte decidida** (API oficial, pg-boss, construtor de fluxos, começar pelo lembrete; fase 0 feita). Falta: confirmar o provedor (ver 10) e o opt-in | G |
| 09 | [Marketing, etapa 2: campanhas](09-marketing-campanhas.md) | ⏸️ **Em espera.** Segmentos reutilizáveis com contagem; campanha única ou contínua; só pacientes com consentimento | M–G |
| 10 | [Provedor do WhatsApp: Meta direto ou provedor parceiro](10-provedores-whatsapp.md) | ⏸️ **Em espera** (task 30). **Gupshup:** com as mensagens incluídas nos planos (decisão 11), a plataforma paga; a Gupshup é a mais barata que cobra a plataforma (a Twilio cobra também as mensagens recebidas). Falta confirmar | P (decisão) |

## Decididas

| # | Decisão | O que foi decidido | Quando |
|---|---|---|---|
| 11 | [Planos e preços](11-planos-e-precos.md) | Por clínica, com faixas de profissionais: Individual R$ 99 (1 profissional, 200 lembretes), Essencial R$ 149 (até 5, 500 lembretes), Profissional R$ 299 (até 10, 1.000 lembretes, 250 agendamentos pelo bot), Completo R$ 549 (até 20, 2.000 lembretes, 500 agendamentos, campanhas). Lembrete excedente a R$ 0,15; teste de 14 dias sem cartão no Essencial, sem WhatsApp (depois, só leitura por 30 dias e suspensão); desconto anual de 10%; Asaas (task 29) | 14/10/2026 |
| 07 | [Sessão, logout e onde o front guarda o token](07-sessao-e-token.md) | Token de acesso de 15 min em memória + refresh rotativo em cookie `HttpOnly` + `POST /auth/logout`. Domínio próprio exige a API servida no domínio da clínica (proxy) | 14/10/2026 |

Funcionalidades já decididas, mas sem data (como **várias unidades da mesma clínica**), ficam em [`docs/roadmap/`](../roadmap/00-indice.md).

## Dependências entre elas

- **08 substitui a opção D da 04** (lembrete por WhatsApp) e precisa do **fuso da clínica** (primeira parte da 03). O agendamento pelo bot (fase 3 da 08) precisa da grade de horários (03, opção B).
- **09 depende da 08:** envio por WhatsApp, fila e consentimento.
- **10 destrava a fase 1 da 08:** sem provedor escolhido e registro na Meta, não há envio.
- **11 decide a 10 e muda a 05:** as mensagens estão incluídas nos planos, então a plataforma paga a Meta: o provedor precisa ser um que cobre a plataforma (Gupshup ou Twilio), e não Meta direto.
- **03 e 04 dependem de um fuso horário por clínica**, que hoje não existe: a API trabalha só em UTC. "Atende das 8h às 18h" e "lembrete às 9h da manhã" só fazem sentido no horário local da clínica. Se 03 ou 04 forem aprovadas, o fuso vira o primeiro passo.
- **01 e 02 se cruzam:** a regra de quem vê dado clínico (01) vale para a evolução (02). Vale decidir as duas juntas.
- **01 conversa com a LGPD** (próxima sessão): restringir dado clínico a quem precisa dele é o princípio da necessidade da lei.
