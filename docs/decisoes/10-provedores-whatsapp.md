# 10 · Provedor do WhatsApp: Meta direto ou provedor parceiro (BSP)

> ⏸️ **Em espera desde 14/10/2026.** Recomendação: **Gupshup** (falta a confirmação). Consolidado na task 30.

**Situação:** em decisão, com recomendação revista em 14/10/2026: **Gupshup** (ver "Recomendação revista"), porque os planos da decisão 11 incluem as mensagens. Falta a confirmação.
**Pesquisa feita em:** 14/10/2026. Preços em dólar e euro convertidos de forma aproximada (US$ 1 ≈ R$ 5,50; € 1 ≈ R$ 6,10). **Confira os valores atuais antes de contratar**: preços de provedor mudam com frequência.

## Dois fatos que mudaram a análise

1. **Em qualquer caminho, a plataforma precisa virar *Tech Provider* da Meta** para que cada clínica conecte o próprio número pela nossa tela (cadastro guiado, o *Embedded Signup*):
   - **Meta direto:** é o próprio programa.
   - **Twilio:** o programa para software de terceiros (ISV) é o *Tech Provider* da Meta, integrado à Twilio.
   - **360dialog:** a partir do 4º número conectado, o parceiro precisa estar registrado como *Tech Provider*.
   - **Gupshup:** pede o *Solution ID* da Meta, que sai do mesmo registro.

   O registro exige verificação da empresa na Meta (de 2 a 5 dias úteis), revisão do app com dois vídeos de demonstração (envio de mensagem e criação de modelo) e acesso avançado a duas permissões da API. Ou seja, **o provedor não poupa o trabalho com a Meta**, que era o principal motivo para escolhê-lo na decisão 08.

2. **Desde 1º/10/2026, a Meta cobra também as mensagens de serviço** (respostas dentro da janela de 24 h) e as de utilidade dentro da janela, que antes eram grátis. O preço é o mesmo da mensagem de utilidade. Cada resposta do bot passa a custar.

## Preço da Meta no Brasil (vale para todos os caminhos)

Cobrança por mensagem **enviada pela clínica** (a mensagem que o paciente manda não é cobrada pela Meta). Contas brasileiras passam a ser faturadas em reais (obrigatório até 30/06/2027).

| Categoria | Preço por mensagem | Exemplo |
|---|---|---|
| Marketing | **R$ 0,3217** (US$ 0,0625) | Campanha |
| Utilidade | **R$ 0,035** (US$ 0,0068) | Lembrete de consulta |
| Serviço (resposta na janela de 24 h) | **R$ 0,035** (desde 1º/10/2026) | "Consulta confirmada!", respostas do fluxo |

Marketing custa cerca de 9 vezes mais que utilidade: a categoria em que cada modelo é aprovado pesa muito no custo.

## Os caminhos

| | **Meta direto (Cloud API)** | **Twilio** | **360dialog** | **Gupshup** | **Zenvia** |
|---|---|---|---|---|---|
| Taxa do provedor | Nenhuma | US$ 0,005 por mensagem, **enviada ou recebida** | Mensalidade fixa, sem margem por mensagem (ver abaixo) | US$ 0,001 por mensagem + margem em marketing (6%, ou US$ 0,0038 no Brasil fora da rota "MM Lite") | Planos de software + pacotes de disparo; parceria por negociação |
| Mensalidade | Nenhuma | Nenhuma | Por número: € 49 (Regular), € 99, € 500. **Plano para plataformas:** € 250/mês + € 49 por número; € 500 + € 25; € 1.000 + € 15 | Nenhuma | Software até R$ 3.900/mês; canal WhatsApp de R$ 100/mês (182 disparos) a R$ 2.000/mês; R$ 649 de habilitação |
| Repassa a Meta sem margem | Não há repasse (paga direto) | Sim | Sim | Em utilidade e serviço, sim; em marketing, não | Embutido nos pacotes |
| Quem paga a Meta | **A clínica**, com cartão próprio cadastrado na Meta (um *Tech Provider* não pode estender crédito aos clientes) | A plataforma (a Twilio cobra a gente, e a gente repassa) | A plataforma ou a clínica, conforme o contrato de parceiro | A plataforma (carteira pré-paga do parceiro) | A plataforma |
| Feito para plataforma com muitos clientes | Sim (*Tech Provider*) | Sim (subcontas, API para cadastrar números em lote) | Sim (plano para plataformas) | Sim (portal e API de parceiro) | Pouco: produto voltado ao atendimento da própria empresa |
| Formato da API | O da Meta | Próprio da Twilio | O da Meta, repassado | O da Meta, repassado, ou próprio | Próprio |
| Trocar de caminho depois | — | Mais trabalho (API própria) | Fácil (mesmo formato da Meta) | Fácil (repasse) | Mais trabalho |
| Suporte e garantia | Só a Meta (documentação e suporte de desenvolvedor) | Suporte e SLA da Twilio | Suporte 24/7 e SLA conforme o plano | Suporte de parceiro | Suporte local, em português |

**Fora da tabela, de propósito: APIs não oficiais** (Evolution API, Z-API, WPPConnect, as que costumam aparecer em automações com n8n). São baratas e não têm aprovação de modelos, mas o número da clínica pode ser banido pela Meta, violam os termos do WhatsApp e não têm contrato nem garantia para dado de paciente. Não servem para um SaaS que vende o atendimento às clínicas.

## Quanto custa por clínica (estimativa)

Cenário: clínica com **400 consultas por mês**, todos os pacientes com consentimento para WhatsApp. Cada consulta gera 1 lembrete (utilidade), 1 toque do paciente num botão (recebida) e 1 resposta do bot (serviço). São 800 mensagens enviadas e 400 recebidas.

| Caminho | Meta | Provedor | **Total por mês** |
|---|---|---|---|
| Meta direto | 800 × R$ 0,035 = R$ 28 | — | **≈ R$ 28** |
| Gupshup | R$ 28 | 800 × US$ 0,001 ≈ R$ 4 | **≈ R$ 32** |
| Twilio | R$ 28 | 1.200 × US$ 0,005 ≈ R$ 33 | **≈ R$ 61** |
| 360dialog, plano para plataformas (50 clínicas, € 500 + € 25 por número) | R$ 28 | ≈ € 35 por clínica ≈ R$ 214 | **≈ R$ 242** |
| 360dialog, por número (€ 49) | R$ 28 | ≈ R$ 300 | **≈ R$ 328** |

Para **campanhas**, o peso é da Meta: 1.000 mensagens de marketing custam ≈ R$ 322 em qualquer caminho. Na Gupshup, somam-se de 6% a US$ 0,0038 por mensagem; na Twilio, US$ 0,005 por mensagem.

A 360dialog compensa com volume alto por número, porque não cobra por mensagem. Clínica pequena manda pouco, e a mensalidade fixa por número pesa.

## Recomendação revista (14/10/2026): Gupshup

A decisão 11 pôs as mensagens **dentro dos planos**: quem paga a Meta é a plataforma. Meta direto não serve nesse modelo (nele, a Meta cobra cada clínica no cartão dela). Entre os provedores que cobram a plataforma, a **Gupshup**:

| | Gupshup | Twilio |
|---|---|---|
| Taxa do provedor | US$ 0,001 por mensagem **enviada** | US$ 0,005 por mensagem **enviada ou recebida** |
| Custo de um lembrete com confirmação | ≈ R$ 0,08 | ≈ R$ 0,15 |
| Essencial com a franquia cheia (500 lembretes) | R$ 40 (27% de R$ 149) | R$ 75 (50% de R$ 149) |
| Margem no lembrete excedente vendido a R$ 0,15 | ~45% | ~zero |

- **A Twilio cobra também o que o paciente manda.** Num bot, quem mais escreve é o paciente. O custo por lembrete quase dobra, e o excedente deixa de dar margem. Os planos foram calculados com o custo da Gupshup.
- **A Gupshup repassa o formato da API da Meta:** dá para migrar depois para a 360dialog ou para a Meta direto (como *Solution Partner*, que permite cobrar as clínicas) sem refazer a integração.
- **Tem API de parceiro** para conectar o número de cada clínica pela nossa tela.

**O que se perde:** a Twilio tem documentação, SDKs e reputação melhores. A Gupshup funciona com **saldo pré-pago**: a plataforma precisa monitorar e recarregar, senão as mensagens param (alerta de saldo baixo na fase 1). O provedor continua plugável: se a Gupshup decepcionar, a Twilio entra como outra implementação, com margem menor.

## Recomendação original (antes da decisão 11)

**Meta direto (Cloud API), como *Tech Provider*.**
- O registro na Meta é necessário em qualquer caminho. Feito isso, o provedor só acrescenta custo.
- É o menor custo (≈ R$ 28 por mês por clínica no cenário acima) e não cria dependência de terceiro: a API é a da própria Meta.
- O provedor continua **plugável** (decisão 08). Se um dia precisarmos de crédito compartilhado ou de suporte com garantia, uma implementação Gupshup ou 360dialog entra sem mudar o resto, porque as duas repassam o formato da Meta.

**O que muda com essa escolha:**
- **Quem paga as conversas:** a clínica, direto para a Meta, com o cartão dela, cadastrado no próprio cadastro guiado. É transparente (a clínica vê o que gasta), mas acrescenta um passo no cadastro. Se o produto preferir embutir o custo na mensalidade, o caminho é a **Twilio**: simples, sem mensalidade, cobra a plataforma e aceita lote de números. Custa ≈ R$ 33 a mais por clínica no cenário acima.
- **Suporte:** só o da Meta. Problema de entrega ou de bloqueio de número é resolvido com a Meta, sem intermediário.

## O que fazer, se aprovada

1. **Registro na Meta**, em paralelo ao código, porque leva dias ou semanas:
   - conta de negócios com verificação e autenticação em dois fatores;
   - app do tipo "Business" com o produto WhatsApp;
   - revisão do app, com os dois vídeos, que só podem ser gravados quando a fase 1 enviar mensagem e criar modelo.
2. **Fase 1 da decisão 08**, com a implementação "Meta Cloud API" do provedor plugável, e o dublê nos testes.
3. **Limite inicial da Meta:** 10 clínicas novas a cada 7 dias até concluir a verificação; 200 depois.

## Perguntas para você

- [ ] **Gupshup** (recomendado) ou Twilio?
- [x] **Quem paga as conversas:** a plataforma, com as mensagens incluídas nos planos (decisão 11).
- [ ] **Quem cuida do registro na Meta** (conta de negócios da empresa, documentos da verificação)? Precisa ser alguém com acesso aos dados da empresa dona da plataforma.

## Fontes

- Meta: [preços da plataforma](https://developers.facebook.com/docs/whatsapp/pricing), [cobrança de mensagens de serviço e utilidade a partir de 1º/10/2026](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages), [como virar *Tech Provider*](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- Preços no Brasil: [Message Central](https://www.messagecentral.com/blog/whatsapp-business-api-pricing-in-brazil), [Hyperleap (calculadora em reais)](https://hyperleap.ai/whatsapp-pricing-calculator-brazil)
- Twilio: [preços do WhatsApp](https://www.twilio.com/en-us/whatsapp/pricing), [programa *Tech Provider* para ISVs](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program), [Senders API](https://www.twilio.com/en-us/changelog/senders-api-whatsapp)
- 360dialog: [preços](https://360dialog.com/pricing), [registro como *Tech Provider* (exigido a partir do 4º número)](https://docs.360dialog.com/partner/get-started/quickstarts/register-as-a-meta-tech-provider)
- Gupshup: [análise de preços (CampaignHQ)](https://blog.campaignhq.co/gupshup-whatsapp-pricing), [documentação de parceiros](https://partner-docs.gupshup.io/docs/introduction), [APIs de cadastro de clientes](https://partner-docs.gupshup.io/docs/onboarding-apis)
- Zenvia: [regras de preço do WhatsApp em 2026](https://zenvia.com/en/new-whatsapp-business-pricing-rules-for-2026/), [planos e preços](https://zenvia.com/en/prices/), [programa de parceiros](https://zenvia.com/blog/zenvia-partners/)
- *Tech Provider* × *Solution Partner* (crédito compartilhado): [360dialog](https://360dialog.com/blog/meta-tech-provider-tiers/), [Whautomate](https://whautomate.com/whatsapp-tech-provider-vs-bsp)
