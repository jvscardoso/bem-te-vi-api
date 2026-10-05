# 03 · Horários de atendimento

**Esforço:** M (mais P para o fuso, que é pré-requisito)

## Situação atual

- Não existe grade de disponibilidade: dá para agendar **qualquer dia, a qualquer hora**, inclusive às 3h da manhã de um domingo.
- A API só garante duas coisas: o mesmo profissional não tem dois agendamentos sobrepostos, e a duração respeita o mínimo da clínica.
- **Não existe fuso horário da clínica.** Tudo é UTC, e o front converte. Para "atende das 8h às 18h" ou "fechado no feriado", a API precisa saber o fuso da clínica (Brasil tem mais de um: `America/Sao_Paulo`, `America/Manaus`, `America/Noronha`...).

## Opções

### A. Não ter grade no MVP
O front mostra a grade do dia inteiro, e a recepção usa o bom senso.
- ✅ Zero esforço.
- ❌ O front não consegue sugerir "próximos horários livres". Não há bloqueio de férias nem de feriado.

### B. Grade semanal por profissional, como aviso (recomendada)
- **Fuso da clínica** (`Tenant.timezone`, padrão `America/Sao_Paulo`). É o pré-requisito.
- **Grade semanal** por profissional: dia da semana + início + fim, com vários intervalos por dia para cobrir o almoço. Exemplo: seg 08:00–12:00 e 13:00–18:00.
- **Bloqueios avulsos:** férias, congresso, feriado. Pode ser por profissional ou da clínica inteira.
- **Rota de horários livres:** `GET /professionals/:id/availability?from&to` devolve os intervalos livres, já descontando agendamentos e bloqueios. O front usa para sugerir horários.
- **Fora da grade não bloqueia, só avisa:** o agendamento é criado e a resposta traz `outsideWorkingHours: true`, e o front mostra um alerta. Encaixe fora do horário é comum em clínica, e bloquear de verdade irritaria a recepção.
- ✅ Resolve o dia a dia sem engessar.
- ❌ Precisa de tela de configuração de horários no front.

### C. Grade com bloqueio rígido
Igual a B, mas recusa (`409`) agendamentos fora da grade, com uma permissão para quem pode forçar encaixe.
- ✅ Garante a disciplina da agenda.
- ❌ Mais regras e mais atrito. Melhor deixar para quando houver agendamento online pelo paciente, em que a grade **precisa** bloquear.

## Pontos a decidir

1. **A grade é por profissional ou da clínica?** Recomendo **por profissional**, com um padrão da clínica para quem não configurar a sua.
2. **Fora da grade: avisa ou bloqueia?** Recomendo **avisa** (opção B).
3. **Feriados nacionais automáticos** ou cadastrados à mão como bloqueio? Recomendo **à mão** no MVP: feriados municipais variam, e uma lista automática só cobriria os nacionais.
4. **Quem configura a grade:** o próprio profissional, o admin ou os dois? Recomendo os dois, no mesmo modelo de `PATCH /users/me/appointment-settings`.

## Impacto (opção B)

- **Banco:** `Tenant.timezone`, tabela de grade semanal e tabela de bloqueios.
- **API:** CRUD da grade e dos bloqueios, rota de horários livres e o aviso no agendamento. É a parte de maior cuidado, por causa dos cálculos com fuso e horário de verão. O Brasil não tem horário de verão hoje, mas a lógica deve usar o fuso IANA, sem deslocamento fixo.
- **Front:** tela "Meus horários", calendário mostrando fora do expediente em cinza e sugestão de horários livres.

## Perguntas para você

- [ ] A, B ou C?
- [ ] Grade por profissional, da clínica ou as duas?
- [ ] Fora da grade: avisa ou bloqueia?
