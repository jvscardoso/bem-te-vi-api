# Várias unidades da mesma clínica

**Situação:** no roadmap. O produto decidiu em 14/10/2026 que vai suportar ("com fé em Deus, teremos clínicas com várias unidades como clientes"). Sem data.
**Esforço:** M
**Origem:** a definição dos planos (decisão 11), com cobrança por clínica.

## Como é hoje

**Não há suporte a unidades.** Uma clínica (tenant) é um lugar só:
- a agenda é por profissional, sem local, sala ou endereço;
- pacientes, financeiro, papéis, marca e endereço (subdomínio) são da clínica inteira;
- o **email do usuário é único em toda a plataforma**, então o mesmo profissional não pode ter conta em duas clínicas.

Uma rede com duas unidades hoje teria duas saídas, as duas ruins:
- **Uma clínica só:** funciona, mas não há como separar a agenda, os relatórios e o financeiro por unidade.
- **Uma clínica por unidade:** os pacientes não são compartilhados (o mesmo paciente, cadastrado duas vezes, com dois prontuários), e quem atende nas duas unidades precisa de dois emails.

## Desenho proposto: unidades dentro da clínica

A clínica continua sendo uma conta só (uma assinatura, uma marca, um cadastro de pacientes e um prontuário), e ganha **unidades**:

- **Unidade:** nome, endereço, telefone, fuso (pode diferir entre unidades) e, opcionalmente, salas.
- **Agendamento ganha a unidade.** A checagem de sobreposição continua por profissional: ele não está em dois lugares ao mesmo tempo.
- **Profissional atende em uma ou mais unidades.** A lista de profissionais e a agenda filtram por unidade.
- **Financeiro e relatórios por unidade:** a cobrança herda a unidade do agendamento.
- **Acesso por unidade (opcional):** a recepção da unidade A vê só a agenda da A. Seria uma regra de escopo, como a de `appointments:all`.
- **Pacientes e prontuário continuam da clínica:** o paciente é atendido em qualquer unidade, com um histórico só.
- **Clínica de uma unidade só não vê diferença:** nasce com uma "unidade principal", e os dados atuais vão para ela na migration.
- **WhatsApp (decisão 08):** um número por unidade ou um só para a clínica, a decidir. O lembrete leva o endereço da unidade da consulta.
- **Plano (decisão 11):** a assinatura é da clínica, e o número de unidades vira um limite do plano (ex.: unidades extras no plano Completo).

### Alternativa descartada: uma clínica por unidade, agrupadas numa rede

Cada unidade seria uma clínica separada, ligada a uma "rede" só para cobrança e relatório consolidado. Dá isolamento total, mas duplica pacientes e prontuários entre unidades, e o profissional precisaria de um usuário por unidade (exigiria mudar o email único global). Não serve ao paciente que é atendido em mais de uma unidade, o caso comum numa rede.

## O que falta decidir antes de começar

- [ ] A **recepção vê só a própria unidade**, ou todas?
- [ ] **Um número de WhatsApp por unidade** ou um só para a clínica?
- [ ] **Quantas unidades em cada plano**, e o preço da unidade adicional?
- [ ] Relatórios **consolidados da rede** (todas as unidades juntas) desde a primeira versão?
