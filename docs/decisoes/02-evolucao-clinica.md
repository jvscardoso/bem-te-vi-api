# 02 · Evolução clínica

**Esforço:** P–M · **Relacionada a:** 01 (quem vê dado clínico)

## Situação atual

Hoje há dois lugares onde o profissional registra algo clínico:

| Onde | Como é | Problema para "evolução" |
|---|---|---|
| **Ficha de anamnese** (`AnamnesisRecord`) | Formulário configurável pela clínica, **imutável** depois de salvo, com quem preencheu e quando | **Não é ligada à consulta**: não dá para saber de qual atendimento é aquela ficha |
| **Observação do agendamento** (`Appointment.notes`) | Texto livre | **Editável a qualquer momento, inclusive depois de o atendimento ser encerrado, e sem histórico**: o que estava escrito antes se perde. Não serve como registro clínico |

"Evolução" é o registro do que aconteceu em cada atendimento: queixa, conduta, prescrição, retorno. É o centro do prontuário de um sistema de clínica.

## Opções

### A. Usar a anamnese como está
A clínica cria um formulário chamado "Evolução" (por exemplo, um campo `textarea`) e preenche a cada consulta.
- ✅ Zero esforço. Já é imutável e já registra autor e data.
- ❌ Não liga à consulta: a evolução não aparece no atendimento, e não dá para cobrar "consulta sem evolução registrada".
- ❌ O nome "anamnese" para tudo confunde o usuário.

### B. Generalizar a anamnese em "registro clínico" (recomendada)
Ajustes pequenos no que já existe:
- `appointmentId` **opcional** no registro (`AnamnesisRecord`): o registro feito durante uma consulta fica ligado a ela.
- Um **tipo de formulário** (`anamnese` ou `evolução`) no `AnamnesisTemplate`, para o front separar as abas "Anamnese" e "Evoluções".
- Rota para listar os registros de um agendamento (tela do atendimento).
- Continua **imutável**: corrigir é registrar um **adendo**, um novo registro que referencia o anterior. O original nunca é apagado nem reescrito. Esse é o comportamento esperado de prontuário: a correção não pode apagar o que foi escrito.
- ✅ Reaproveita validação, permissões e testes da anamnese.
- ✅ A clínica define o formato da evolução (texto livre ou campos como "conduta" e "retorno").
- ❌ O nome interno continua "anamnesis" no código. Dá para renomear depois, sem pressa.

### C. Modelo próprio de evolução (`ClinicalNote`)
Entidade nova: texto livre (talvez com formatação), sempre ligada a um agendamento, com adendos.
- ✅ Modelo "puro", sem herdar o vocabulário da anamnese.
- ❌ Duplica a infraestrutura de registro clínico (permissões, escopo, imutabilidade, auditoria) que B reaproveita.

## Recomendação junto: travar `Appointment.notes`

Independentemente da opção, `notes` do agendamento deve ser tratado como **observação administrativa** ("paciente pediu horário de manhã"), não clínica. Sugestão: depois que o agendamento é encerrado (`completed`, `cancelled`, `no_show`), `notes` também fica bloqueado, ou passa a ter histórico. Hoje dá para reescrever a observação de um atendimento de meses atrás sem rastro.

## Pontos a decidir

1. **A evolução precisa estar ligada a um agendamento sempre, ou pode ser avulsa** (contato por telefone, resultado de exame)? Recomendo **opcional**.
2. **Correção por adendo** (imutável) **ou edição com histórico de versões?** Recomendo **adendo**: mais simples e mais seguro juridicamente.
3. **Assinatura digital** (certificado ICP-Brasil) para dispensar o papel: fica **fora do MVP**. Hoje autor e data ficam registrados, mas não há assinatura com validade jurídica. Vale confirmar com um profissional da área o que as clínicas-alvo exigem.

## Impacto (opção B)

- **Banco:** dois campos novos (`appointmentId` e `replacesRecordId` no registro; `kind` no formulário). Migração sem perda: registros antigos ficam sem agendamento.
- **API:** filtros e rota por agendamento, criação de adendo, trava em `notes`.
- **Front:** aba "Evoluções" na ficha do paciente e na tela do atendimento; botão "Adicionar adendo".

## Perguntas para você

- [ ] A, B ou C?
- [ ] Evolução sempre ligada a consulta ou opcional?
- [ ] Correção por adendo ou edição com histórico?
- [ ] Travar `notes` do agendamento depois de encerrado?
