# 05 · Cobrança das clínicas pela plataforma

**Esforço:** P (manual) → M (plano e teste no banco) → G (gateway de pagamento)

## Situação atual

- Qualquer pessoa cria uma clínica e usa **tudo, de graça, por tempo indeterminado**.
- O painel da plataforma consegue **suspender** e **reativar** uma clínica. Com a clínica suspensa, ninguém dela loga, e o endereço dela mostra a marca padrão.
- Não existe plano, período de teste, limite (de usuários, pacientes, etc.) nem registro de pagamento da clínica.

O módulo financeiro que existe hoje é o **da clínica com os pacientes dela**. É outra coisa: aqui a questão é como **o bem-te-vi cobra das clínicas**.

## Opções

### A. Manual (recomendada para os primeiros clientes)
Cobrança fora do sistema (Pix, boleto, nota fiscal pelo seu contador). Inadimplente é suspenso pelo painel da plataforma.
- ✅ Zero esforço. Permite validar preço e plano com os primeiros clientes antes de automatizar.
- ❌ Não escala. Tudo depende de você lembrar de suspender ou reativar.

### B. Plano e período de teste no banco, pagamento manual
- Campos na clínica: `plan`, `trialEndsAt`, `paidUntil`.
- Ao cadastrar, a clínica ganha um período de teste (por exemplo, 14 dias).
- **Passada a data, a clínica entra em modo restrito, sem suspensão total:** consegue ler e exportar os dados, mas não cria nada. Bloquear o acesso aos próprios dados de uma clínica que não pagou é ruim para a LGPD e para a relação com o cliente.
- O painel da plataforma ganha "registrar pagamento até dd/mm" e um filtro de "vence em 7 dias".
- Limites por plano (número de profissionais, por exemplo) entram aqui, se fizerem parte do preço.
- ✅ Automatiza o fim do período de teste e o vencimento sem integrar com ninguém.
- ❌ O pagamento continua manual.

### C. Gateway de pagamento
Assinatura recorrente automática: cartão, Pix ou boleto, por um provedor como Asaas, Iugu, Pagar.me ou Stripe.
- ✅ Cobrança, recibos e inadimplência automáticos.
- ❌ Integração com webhooks e conciliação, mais as taxas do provedor. Só compensa com volume de clientes.

## Recomendação

Começar com **A**. Passar para **B** quando houver uns 10 clientes, ou antes, se quiser período de teste no autoatendimento. Deixar **C** para quando a operação manual pesar.

## Pontos a decidir

1. **Como será o preço:** por clínica, por profissional ou por faixa de pacientes? Isso define que limites o sistema precisa contar.
2. **Período de teste no autoatendimento?** Se sim, B entra mais cedo.
3. **O que acontece com a clínica inadimplente:** modo restrito (recomendado) ou suspensão total?
4. **Nota fiscal do serviço do bem-te-vi para a clínica:** fica com o seu contador no começo.

## Impacto (opção B)

- **Banco:** três ou quatro campos na clínica.
- **API:** um guarda que bloqueia escrita quando a clínica está vencida (as leituras continuam), além das rotas do painel.
- **Front:** aviso de "seu período de teste acaba em X dias" e tela de clínica vencida.

## Perguntas para você

- [ ] Começar manual (A)?
- [ ] Qual o modelo de preço?
- [ ] Vai ter período de teste no autoatendimento?
