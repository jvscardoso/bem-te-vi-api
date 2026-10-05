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

## Dependências entre elas

- **03 e 04 dependem de um fuso horário por clínica**, que hoje não existe: a API trabalha só em UTC. "Atende das 8h às 18h" e "lembrete às 9h da manhã" só fazem sentido no horário local da clínica. Se 03 ou 04 forem aprovadas, o fuso vira o primeiro passo.
- **01 e 02 se cruzam:** a regra de quem vê dado clínico (01) vale para a evolução (02). Vale decidir as duas juntas.
- **01 conversa com a LGPD** (próxima sessão): restringir dado clínico a quem precisa dele é o princípio da necessidade da lei.
