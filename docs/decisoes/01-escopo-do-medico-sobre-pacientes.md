# 01 · Escopo do médico sobre pacientes e prontuário

**Esforço:** M · **Relacionada a:** 02 (evolução), LGPD

## Situação atual

A agenda já tem escopo: sem `appointments:all`, o médico só vê a própria agenda. **Pacientes e prontuário não têm:**

| Permissão | O que libera hoje |
|---|---|
| `patients:read` | **Todos** os pacientes da clínica, com dados cadastrais **e** todas as fichas de anamnese |
| `patients:write` | Criar, editar e remover **qualquer** paciente e preencher anamnese em qualquer um |
| `billing:read` | **Todas** as cobranças da clínica |

Resultado: um médico recém-cadastrado não vê a agenda dos colegas, mas abre a ficha de qualquer paciente da clínica, inclusive de quem nunca atendeu, e lê a anamnese feita por outro profissional.

## Por que importa

- **Sigilo médico e LGPD:** dado de saúde é dado sensível. O princípio da necessidade pede que cada pessoa acesse só o que precisa para a sua função.
- **A recepção precisa do cadastro** (nome, telefone, CPF) para agendar e cobrar, mas não precisa ler anamnese.
- **Consistência:** a regra que você pediu para a agenda ("o médico novo vê só o que é dele") naturalmente se estende ao paciente.

## Opções

### A. Manter como está
Toda a equipe com `patients:read` vê todo paciente e todo prontuário.
- ✅ Zero esforço. Funciona em clínica pequena em que todos atendem todos.
- ❌ Incoerente com o escopo da agenda. A recepção lê dado clínico. Fraco para a LGPD.

### B. Escopo de paciente igual ao da agenda
Nova permissão `patients:all`. Sem ela, o profissional só vê pacientes **vinculados** a ele.
- ✅ Simples de explicar ("igual à agenda").
- ❌ Esconde também o **cadastro**, que a recepção e o próprio médico precisam para agendar um paciente novo.
- ❌ O vínculo precisa ser definido. Um paciente cadastrado pelo médico, antes da primeira consulta, sumiria da lista dele. Isso exige guardar quem cadastrou.

### C. Separar dado cadastral de dado clínico (recomendada)
Dois níveis de acesso:

| Nível | Conteúdo | Quem vê |
|---|---|---|
| **Cadastro** | Nome, CPF, contato, endereço | Quem tem `patients:read`, como hoje. A recepção continua funcionando |
| **Clínico** | Anamnese, evolução (02), observações clínicas | Nova permissão `clinical_records:read` (e `:write`), com escopo: só pacientes **vinculados** ao profissional, ou todos com `clinical_records:all` |

**Vínculo** = o profissional tem ou teve agendamento com o paciente, ou já registrou algo clínico nele.

- ✅ Recepção e financeiro trabalham sem ver prontuário.
- ✅ O médico vê o prontuário de quem ele atende, inclusive o histórico feito por colegas com aquele paciente, o que é útil quando o paciente troca de médico.
- ✅ É o desenho que melhor sustenta a LGPD (sessão 2).
- ❌ Mais trabalho que A e B. O front precisa separar as abas da ficha do paciente.

## Pontos a decidir dentro da opção C

1. **O médico vê o histórico clínico feito por outros profissionais com o mesmo paciente?** Recomendo **sim**, desde que ele também atenda o paciente: continuidade do cuidado.
2. **O cadastro do paciente também deve ter escopo para o médico** (lista de pacientes só com os dele)? Recomendo **não** no MVP: a lista completa ajuda a evitar cadastro duplicado.
3. **Financeiro:** fica de fora do escopo do médico. É uma área da clínica, e o papel "Médico" normalmente nem tem `billing:read`.
4. **Dono e diretor clínico** recebem `clinical_records:all`.

## Impacto

- **API:**
  - Novas permissões no catálogo.
  - As rotas de anamnese (e de evolução, decisão 02) passam a checar escopo.
  - A resposta do paciente deixa de embutir dado clínico (hoje já não embute; a anamnese tem rota própria).
- **Banco:** migração que concede as permissões novas a todo papel que hoje tem `patients:read` ou `patients:write`. Ninguém perde acesso no deploy, e depois você restringe os papéis pelo editor, como foi feito com `appointments:all`.
- **Front:** a ficha do paciente esconde as abas clínicas sem a permissão. O editor de papéis mostra as permissões novas.

## Perguntas para você

- [ ] A, B ou C?
- [ ] Se C: o médico vê o histórico clínico feito por colegas com pacientes que ele também atende?
- [ ] Se C: a lista de pacientes continua completa para o médico?
