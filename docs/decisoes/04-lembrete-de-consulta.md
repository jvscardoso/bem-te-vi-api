# 04 · Lembrete de consulta

**Esforço:** M (G se incluir WhatsApp)

## Situação atual

- **Não há lembrete.** O status `confirmed` existe, mas só a recepção muda ele, à mão.
- O envio de email já existe (SMTP, com Mailpit em dev), usado na recuperação de senha e no convite.
- **Não há agendador de tarefas** na API: nada roda "a cada X minutos". Um lembrete precisa disso.
- O email do paciente é **opcional** no cadastro.
- **Não há fuso da clínica** (ver decisão 03). "Lembrete às 9h" depende disso.

## Por que importa

Falta (`no_show`) é um dos maiores prejuízos de uma clínica, e lembrete com confirmação é uma das funções mais valorizadas por quem compra esse tipo de sistema.

## Opções

### A. Sem lembrete no MVP
- ✅ Zero esforço.
- ❌ Perde um argumento de venda forte.

### B. Lembrete por email
Email automático, por exemplo 24h antes, para agendamentos `scheduled` ou `confirmed` de pacientes com email.
- ✅ Usa a infraestrutura de email que já existe.
- ❌ O paciente não tem como responder pelo próprio email.

### C. Email com link "Confirmar" / "Preciso desmarcar" (recomendada)
Igual a B, com dois links:
- **Confirmar** muda o agendamento para `confirmed`.
- **Cancelar** muda para `cancelled`. Ou, se preferir que a clínica tente remarcar, só avisa a clínica.
- Os links usam o mesmo mecanismo dos de senha e convite: token de uso único, com validade até o horário da consulta e só o hash no banco.
- ✅ A recepção vê na agenda quem confirmou, sem ligar para ninguém.
- ❌ Precisa de uma página pública simples no front ("Consulta confirmada!").

### D. WhatsApp
É o canal que o paciente brasileiro realmente lê.
- ❌ Exige a API oficial do WhatsApp Business: conta Meta verificada, **mensagens pagas por conversa** e modelos de mensagem aprovados previamente pela Meta. Ou um provedor intermediário (Twilio, Zenvia, etc.).
- Recomendo **depois do MVP**, como canal adicional. Vale desenhar C já pensando em ter mais de um canal.

## Pontos a decidir

1. **Quando enviar:** 24h antes? 48h? A clínica escolhe? Recomendo um padrão de **24h, configurável por clínica**.
2. **"Preciso desmarcar" cancela direto ou só avisa a clínica?** Recomendo **cancelar direto e avisar a clínica**: libera o horário na hora.
3. **Consentimento:** o paciente precisa ter concordado em receber comunicações? Isso entra na sessão de LGPD. Lembrete de consulta tende a ser coberto pela própria prestação do serviço, mas vale registrar uma opção "não quero receber lembretes" no cadastro.
4. **A clínica pode desligar os lembretes?** Recomendo **sim**, com uma chave por clínica.

## Impacto (opção C)

- **Pré-requisito:** fuso da clínica (decisão 03).
- **Infraestrutura:**
  - Agendador de tarefas (`@nestjs/schedule`) rodando a cada poucos minutos.
  - Um controle para que, com mais de uma réplica da API, o mesmo lembrete não saia duas vezes. Dá para usar o mesmo tipo de trava no banco que a agenda já usa.
- **Banco:** marca de "lembrete enviado" no agendamento, configurações na clínica e tokens de confirmação.
- **API:** o job, as rotas públicas de confirmar e cancelar e as configurações.
- **Front:** página pública de confirmação, selo "confirmado pelo paciente" na agenda e configurações de lembrete.

## Perguntas para você

- [ ] A, B, C ou D (depois)?
- [ ] Antecedência do lembrete (fixa ou configurável)?
- [ ] "Desmarcar" cancela direto ou só avisa?
