# 11 · Planos e preços

**Situação:** ✅ **decidida em 14/10/2026** (planos, teste e desconto anual). Em aberto: os custos operacionais (adiados: a infraestrutura inicial vai rodar no serviço de um possível sócio). Muda a decisão 05 (cobrança das clínicas) e decide a 10 (provedor do WhatsApp): se as mensagens entram no plano, quem paga a Meta é a plataforma.
**Pesquisa feita em:** 14/10/2026. Preços de concorrentes conforme sites e comparativos públicos; **confira antes de publicar a tabela**.

## O que o mercado cobra (software de clínica no Brasil)

| Produto | Planos (por profissional, por mês) | Lembrete/confirmação por WhatsApp |
|---|---|---|
| iClinic | Starter R$ 99 · Plus R$ 129 · Pro R$ 169 · Premium R$ 299 | Só a partir do Plus (R$ 129) |
| Feegow | Starter R$ 129 · Plus R$ 199 · VIP R$ 249 | Tem confirmação e agendamento automáticos; se há custo à parte, não está claro |
| Amplimed | Lite R$ 89 · Pro R$ 139 (1 ou 2 profissionais) | Recursos avançados são adicionais pagos |
| Ninsaúde | Individual R$ 199; de 2 a 5 agendas, sob consulta | Lembretes e campanhas de aniversário (sem IA) |
| Simples Dental (odonto, por clínica) | Basic R$ 149,90 · Plus R$ 249,90 · Pro R$ 349,90 | Já no Basic; "secretária com IA" é cobrada à parte |
| Clinicorp (odonto) | A partir de R$ 159,90 | CRM e IA em combo, sob consulta |
| Doctoralia | Planos com campanhas por email e SMS de 300, 1.000 ou 5.000 contatos por mês | Lembretes incluídos |

Padrões que aparecem:
- **Cobrança por profissional** (quem atende), com a recepção sem custo.
- **Entrada entre R$ 89 e R$ 149.** Confirmação por WhatsApp costuma ficar no segundo degrau, por volta de R$ 129.
- **Marketing e CRM** ficam no plano de cima ou como adicional, com **franquia de contatos** (Doctoralia: 300, 1.000 ou 5.000).

## O nosso custo de mensagem

Preço da Meta no Brasil: **R$ 0,035** por mensagem de utilidade ou de serviço (lembrete, resposta do bot) e **R$ 0,32** por mensagem de marketing. A Meta só cobra o que a clínica envia (decisão 10).

| Item | Mensagens enviadas | Meta direto | Gupshup | Twilio |
|---|---|---|---|---|
| Uma consulta com lembrete + confirmação (lembrete e resposta do bot; o paciente toca num botão) | 2 | R$ 0,07 | R$ 0,08 | R$ 0,15 |
| Um agendamento feito pelo bot (≈ 6 mensagens trocadas) | ≈ 6 | R$ 0,21 | R$ 0,24 | R$ 0,38 |
| Uma mensagem de campanha | 1 | R$ 0,32 | R$ 0,35 | R$ 0,35 |

Com Meta direto, **quem paga é a clínica**, com o cartão dela (a Meta não deixa a plataforma pagar pelos clientes nesse modelo). Para **embutir as mensagens no plano**, a plataforma precisa pagar a Meta, e isso só é possível com um provedor que cobre a plataforma: **Gupshup** (o mais barato) ou **Twilio**.

**Por profissional:** com ~200 consultas por mês (10 por dia útil), o lembrete com confirmação custa **≈ R$ 16 por profissional por mês** pela Gupshup (R$ 30 pela Twilio). Num plano de R$ 129, são 12% da receita. Cabe, desde que haja um limite para clínicas fora da curva.

## Respostas de 14/10/2026

- **Cobrança por clínica**, com faixas de profissionais por plano (ex.: Essencial até 5), e não por profissional.
- **Os preços dependem dos custos operacionais**, que ainda vão ser levantados (ver "Custos a levantar").
- **Em vez de um plano "Marketing", um plano completo** com todos os módulos e limites maiores, porque outros módulos virão.
- **Teste grátis de 14 dias, sem cartão.**
- **Gateway de pagamento: Asaas** (conta já criada). A integração está na task 29 (`docs/changes/29-integracao-asaas.md`).
- **Franquia de lembretes:** 500 por mês no Essencial, aumentando nos outros planos (até 2.000), com o excedente cobrado quando a clínica precisar de mais.
- **Várias unidades da mesma clínica:** hoje não há suporte, mas o produto **vai suportar**. Está no roadmap (`docs/roadmap/multiplas-unidades.md`).
- **Revisão do preço do Essencial:** R$ 249 ficou caro para a clínica pequena (ver a nota nos planos).
- **Aprovado:** preços revistos (R$ 149 / R$ 299 / R$ 549), os nomes (Essencial, Profissional, Completo), um plano **Individual** mais limitado (1 profissional, 200 lembretes) e **limite de agendamentos pelo bot** por plano.
- **Custos operacionais: adiados.** A infraestrutura inicial vai rodar no serviço de um possível sócio.
- **Teste:** libera o **Essencial, sem WhatsApp** (nenhuma mensagem paga durante o teste, e nada de cadastro na Meta antes de a clínica contratar). Ao fim do teste sem contratar: **só leitura por 30 dias** (dá para ver e exportar os dados), **depois suspensão**.
- **Desconto anual: 10%** sobre o preço mensal × 12 (a sugestão de "2 meses grátis", ≈ 17%, foi recusada).

## Planos (aprovados como ponto de partida em 14/10/2026)

Cobrança **por clínica**. Cada plano tem uma faixa de profissionais (usuários com `appointments:attend`); recepção e administração não contam. Os números ficam numa tabela no banco (task 29): ajustar preço ou limite não exige deploy.

> **Revisão de 14/10/2026.** A primeira versão por clínica pôs o Essencial em R$ 249, calculado como se a clínica tivesse as 5 vagas preenchidas (R$ 50 por profissional). O cliente mais comum tem 1 ou 2 profissionais, e para ele ficava mais caro que a concorrência. **O preço de entrada precisa servir à clínica pequena.**

| | **Individual** | **Essencial** | **Profissional** | **Completo** |
|---|---|---|---|---|
| **Preço por clínica/mês** | **R$ 99** | **R$ 149** | **R$ 299** | **R$ 549** |
| Profissionais incluídos | 1 | Até 5 | Até 10 | Até 20 |
| Profissional além da faixa | Sobe de plano | Sobe de plano | R$ 29 cada | R$ 25 cada |
| **Lembretes por WhatsApp por mês** (lembrete + confirmação/cancelamento) | **200** | **500** | **1.000** | **2.000** |
| Lembrete além da franquia (se a clínica ativar) | R$ 0,15 cada | R$ 0,15 cada | R$ 0,15 cada | R$ 0,15 cada |
| **Agendamentos pelo bot por mês** | — | — | **250** | **500** |
| Agenda, pacientes, anamnese, financeiro, LGPD, marca da clínica e subdomínio | ✓ | ✓ | ✓ | ✓ |
| Fluxo do WhatsApp editável (construtor de fluxos) | Fluxo padrão, só os textos | Fluxo padrão, só os textos | ✓ | ✓ |
| Caixa de entrada (recepção assume a conversa) | — | — | ✓ | ✓ |
| Domínio próprio da clínica | — | — | ✓ | ✓ |
| Campanhas e segmentos | — | — | — | ✓ (300 mensagens/mês + créditos) |
| Módulos futuros | — | — | — | ✓ |
| Várias unidades | — | — | — | Quando existir (`docs/roadmap/`) |

**Comparando com o mercado:**

| Clínica | Nosso plano | iClinic Plus (R$ 129 por profissional) | Simples Dental Basic (por clínica) |
|---|---|---|---|
| 1 profissional | Individual R$ 99 | R$ 129 | R$ 149,90 |
| 2 profissionais | Essencial R$ 149 (R$ 75 cada) | R$ 258 | R$ 149,90 |
| 5 profissionais | Essencial R$ 149 (R$ 30 cada) | R$ 645 | R$ 149,90 |

### Os limites

- **Lembretes (franquia):** quantas consultas por mês recebem lembrete pelo WhatsApp sem custo extra. Cada lembrete com confirmação custa à plataforma ≈ R$ 0,08. Passou da franquia, a clínica escolhe nas configurações entre **continuar enviando, pagando R$ 0,15 por lembrete excedente** na fatura seguinte, ou **parar de enviar** até o mês seguinte. Avisos em 80% e em 100%.
- **Agendamentos pelo bot (limite, sem excedente por enquanto):** cada agendamento feito pelo bot troca ≈ 6 mensagens (≈ R$ 0,24). Ao chegar no limite do mês, **o bot passa a conversa para a recepção** em vez de agendar sozinho: o paciente não fica sem resposta, e a clínica vê o aviso na caixa de entrada. Se o uso real mostrar demanda, vira franquia com excedente, como os lembretes.
- **Mensagens de campanha (Completo):** 300 por mês; acima disso, créditos (ex.: 1.000 por R$ 450).

### A conta por plano (só o custo de mensagem, pela Gupshup)

| Plano | Receita | Uso típico | Custo típico | Limites cheios | Custo máximo |
|---|---|---|---|---|---|
| Individual (R$ 99) | R$ 99 | 120 lembretes | R$ 10 (10%) | 200 lembretes | R$ 16 (16%) |
| Essencial (R$ 149) | R$ 149 | 2 profissionais, 300 lembretes | R$ 24 (16%) | 500 lembretes | R$ 40 (27%) |
| Profissional (R$ 299) | R$ 299 | 4 profissionais, 600 lembretes + 150 agendamentos pelo bot | R$ 84 (28%) | 1.000 lembretes + 250 agendamentos | R$ 140 (47%) |
| Completo (R$ 549) | R$ 549 | 8 profissionais, 1.200 lembretes + 300 agendamentos + 150 de campanha | R$ 220 (40%) | 2.000 lembretes + 500 agendamentos + 300 de campanha | R$ 385 (70%) |

Lembretes excedentes e créditos de campanha não entram na conta: são cobrados à parte, com margem. O Completo com todos os limites cheios é o caso mais apertado. Vale acompanhar o uso real dos primeiros clientes antes de mexer.

### Custos a levantar (adiado: infraestrutura inicial no serviço de um possível sócio)

| Custo | Tipo | Observação |
|---|---|---|
| Mensagens do WhatsApp | Variável, por consulta e por campanha | Tabela acima (≈ R$ 0,08 por consulta; R$ 0,35 por mensagem de campanha) |
| Hospedagem da API e do front, banco gerenciado, backup | Fixo + cresce com o número de clínicas | Depende do provedor de nuvem (ver "Falta para lançar") |
| Email (SMTP), monitoramento, domínio e certificados (inclusive domínios próprios) | Fixo / pequeno variável | |
| Asaas | Por cobrança recebida (Pix, boleto, cartão) | Consultar a tabela da conta (as taxas variam por meio de pagamento e negociação) |
| Nota fiscal pelo Asaas | R$ 0,49 por nota emitida | Uma por fatura paga |
| Impostos sobre a receita | % da receita | Depende do regime (Simples Nacional, fator R...); confirmar com contador |
| Suporte e implantação | Pessoas | Cresce com o número de clínicas |

Com esses números, a conta por plano é: **preço − custo variável médio (mensagens + Asaas + nota) − impostos − custo fixo rateado**. Posso montar uma planilha com essa fórmula quando os valores estiverem levantados.

### Teste grátis de 14 dias

- **Sem cartão:** a clínica se cadastra e usa; o Asaas só entra quando ela contrata.
- **Decidir:**
  - qual plano o teste libera: o Completo, para mostrar tudo, ou o Essencial;
  - se o WhatsApp funciona no teste. O lembrete custa à plataforma, e conectar o número exige o cadastro na Meta. Sugestão: libera, com limite (ex.: 100 consultas com lembrete no teste);
  - o que acontece ao fim do teste sem contratar. Sugestão: a clínica fica **só leitura** por 30 dias (ainda dá para exportar os dados, por causa da LGPD) e depois é suspensa.

## O que isso decide

- **Decisão 10 (provedor):** se as mensagens entram no plano, como proposto, o caminho é a **Gupshup** (o mais barato que cobra a plataforma) ou a Twilio. Meta direto só serve se a clínica pagar a Meta à parte, e aí as mensagens não estariam "inclusas". Dá para começar pela Gupshup e migrar para *Solution Partner* da Meta (que permite cobrar as clínicas) se o volume justificar.
- **Decisão 05 (cobrança das clínicas):** passa a ser assinatura por clínica, com teste de 14 dias, pelo Asaas (task 29). Exige medir o uso por clínica (consultas com lembrete, mensagens de campanha), o que a fase 1 da decisão 08 já vai registrar.
- **Várias unidades (roadmap):** viram limite de plano quando existirem.

## Ainda em aberto

- [ ] **Provedor do WhatsApp (decisão 10):** recomendação **Gupshup** (a mais barata entre os que cobram a plataforma; a Twilio cobra também as mensagens recebidas e quase dobra o custo por lembrete). Falta confirmar.
- [ ] **Custos operacionais:** levantar quando a infraestrutura estiver definida, para conferir as margens.

## Fontes

- Comparativos de preço: [Conclínica](https://conclinica.com.br/melhores-sistemas-para-clinicas/), [ByDoctor (iClinic)](https://bydoctor.com.br/blog/quanto-custa-iclinic-alternativa-mais-barata), [ClinicaSysPro (Feegow)](https://www.clinicasyspro.com.br/clinicasyspro-vs-feegow.html), [Certu (Clinicorp × Simples Dental)](https://certu.com.br/comparar/clinicorp-ou-simples-dental)
- Páginas de preço: [iClinic](https://iclinic.com.br/precos/), [Feegow](https://feegowclinic.com.br/precos-e-planos), [Doctoralia](https://pro.doctoralia.com.br/preco)
- CRM e marketing: [Triagefy (CRMs médicos 2026)](https://triagefy.io/blog/melhores-crm-medicos-2026), [Ninsaúde Ads](https://www.ninsaude.com/pt-br/marketing-medico/)
- Custos de mensagem: decisão 10 (preços da Meta, Gupshup e Twilio, com fontes)
- Asaas: [assinaturas](https://docs.asaas.com/docs/assinaturas), [nota fiscal automática para assinaturas](https://docs.asaas.com/docs/emitir-notas-fiscais-automaticamente-para-assinaturas), [preço da NFS-e (R$ 0,49)](https://www.asaas.com/nota-fiscal)
