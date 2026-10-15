# 09 · Marketing, etapa 2: campanhas para grupos de pacientes

> ⏸️ **Em espera desde 14/10/2026**, junto da decisão 08. Campanhas entram no plano Completo (decisão 11), depois da fase 1 do WhatsApp (task 30).

**Situação:** em decisão. Começa depois da etapa 1 (decisão 08), que traz o envio por WhatsApp, a fila e o consentimento.
**Esforço:** M–G

## O pedido

Campanhas personalizadas para diferentes tipos de pacientes. A campanha tem **nome**, **duração** e **público-alvo**, escolhido por filtros como gênero, idade, data da última consulta e outros.

## Desenho proposto

### Segmentos separados das campanhas

O público é um **segmento salvo e reutilizável** ("sem consulta há 6 meses", "aniversariantes do mês"), e a campanha aponta para um segmento. A tela mostra **quantos pacientes entram** antes de salvar.

Filtros sugeridos (todos opcionais, combinados com E):

| Filtro | Observação |
|---|---|
| Sexo | **Campo novo no paciente**: hoje não existe. Valores e rótulos a decidir (ver perguntas) |
| Idade (de / até) | Pela data de nascimento, que já existe. Paciente sem data fica de fora |
| Aniversário | No mês, ou nos próximos N dias |
| Última consulta | Antes de / depois de uma data, ou "há mais de N meses". Conta só consultas `completed` |
| Nunca consultou | Cadastrado, sem consulta concluída |
| Profissional | Já foi atendido por ele |
| Faltas | Teve `no_show` no período |
| Consulta futura | Tem ou não tem consulta marcada (ex.: não convidar quem já vai voltar) |

Ficam de fora, de propósito, filtros por **dado clínico** (respostas da anamnese, diagnóstico). Segmentar marketing por dado de saúde é tratamento de dado sensível para uma finalidade diferente da que justificou a coleta, e precisa de base legal própria (LGPD, art. 11). Vale a opinião do advogado antes de abrir essa porta.

**Só entram pacientes que aceitaram marketing** e não pediram "SAIR". A contagem mostra os dois números: "320 no filtro, 210 podem receber".

### A campanha

- **Nome**, **segmento**, **canal** (WhatsApp; email pode vir depois) e **mensagem**, que é um modelo de marketing **aprovado pela Meta**, com variáveis (`{{paciente.nome}}`...).
- **Duração**, com dois tipos:
  - **disparo único:** envia uma vez, numa data e hora;
  - **contínua:** fica ativa entre o início e o fim e envia todo dia a quem entra no segmento naquele dia. É o caso dos aniversariantes e de "6 meses sem consulta".
- **Público congelado no disparo:** o envio usa o segmento como estava na hora; a campanha guarda quem recebeu.
- **Limites:** no máximo uma campanha por paciente a cada N dias (frequência) e envio em ritmo controlado pela fila, para não estourar o limite do número nem a paciência dos pacientes.
- **Estados:** rascunho → agendada → enviando → concluída, mais pausada e cancelada.
- **Métricas:** enviadas, entregues, lidas, respondidas, pediram "SAIR" e **viraram agendamento** (consulta marcada até N dias depois da mensagem). A última é a que mostra o retorno da campanha para a clínica.

### Permissões

| Permissão | Libera |
|---|---|
| `marketing:campaigns` | Criar e editar segmentos e campanhas (rascunho), ver métricas |
| `marketing:send` | Agendar ou disparar uma campanha. Separada porque custa dinheiro e fala com a base inteira |

### LGPD e publicidade

- **Marketing exige consentimento próprio**, separado da comunicação sobre o atendimento (lembrete). Opt-out ("SAIR") em toda mensagem, respeitado na hora.
- **Publicidade médica:** a Resolução CFM 2.336/2023 limita o que clínicas médicas podem divulgar (promessa de resultado, antes e depois, preço como chamariz...). O editor de campanhas deve trazer um aviso, e o texto final é responsabilidade da clínica. Outras áreas (odontologia, psicologia) têm conselhos com regras próprias.
- Campanha disparada entra na trilha de auditoria (quem, quando, para quantos), sem a lista de pacientes no `details`.

## Fases

1. **Sexo no paciente** (campo e filtro), consentimento de marketing (já vem da decisão 08), segmentos com contagem.
2. Campanha de disparo único com métricas.
3. Campanha contínua (aniversariantes, retorno) e limite de frequência.

## Perguntas para você

- [ ] **Sexo/gênero:** um campo "sexo" (feminino, masculino, outro, não informado) ou dois campos (sexo e identidade de gênero)? Recomendo **um campo** no MVP, opcional, com "prefiro não informar".
- [ ] **Os tipos de duração** (disparo único e contínua) atendem o que você imaginou?
- [ ] **Filtros:** falta algum? (Ex.: convênio, bairro/cidade, origem do paciente: hoje nenhum deles existe no cadastro.)
- [ ] **Canal:** só WhatsApp, ou email também na primeira versão (mais barato e não precisa de aprovação da Meta)?
- [ ] **Jurídico:** uso de dado de saúde em segmentação (fica fora até ter parecer) e as regras de publicidade de cada conselho.
