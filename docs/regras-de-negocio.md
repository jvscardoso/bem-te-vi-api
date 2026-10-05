# Regras de negócio

Referência das regras que a API impõe, por domínio. Os detalhes de contrato (campos, exemplos, erros) estão no [README](../README.md); as tasks para o frontend ficam em `docs/changes/` (fora do git). Quando este documento e o código divergirem, vale o código.

## O produto

SaaS **whitelabel** de gestão de clínicas. Cada clínica (tenant) tem a própria marca e o próprio endereço, além de usuários e papéis, pacientes com anamnese, agenda e financeiro. A equipe do bem-te-vi tem um **painel da plataforma** para gerenciar as clínicas como contas, **sem acesso a dado clínico**.

## Clínica (tenant)

- **Cadastro público** (`POST /tenants`): cria clínica, papel "Admin" e usuário dono numa transação. O Admin recebe todo o catálogo de permissões, **exceto as `platform:*`**. O dono precisa aceitar os Termos e a Política vigentes.
- `subdomain` é único (`a-z`, `0-9` e `-`). O **email é único em toda a plataforma**: a mesma pessoa não pode ter conta em duas clínicas com o mesmo email.
- **Duração de atendimento:** padrão (30 min) e mínima (5 min) por clínica. A padrão não pode ser menor que a mínima, e a mínima não pode ficar acima da duração própria de algum profissional.
- **Suspensão** é ação da plataforma, nunca da própria clínica. Clínica suspensa: ninguém loga, sessões abertas caem e a marca pública responde `404`.

## Marca e endereço (whitelabel)

- Marca: nome fantasia, logo (upload PNG/JPEG/WebP até 1 MB, SVG recusado; ou URL `https`) e cores `#RRGGBB`.
- **Resolução por host** (`GET /public/branding?host=`): domínio próprio **verificado** ou `<sub>.<APP_BASE_DOMAIN>`. Em dev, um host sem ponto é o próprio subdomínio. Clínica suspensa, inexistente ou com domínio não verificado → `404`.
- **Domínio próprio** só controla a marca depois de **verificado por DNS** (registro TXT `_bemtevi-challenge.<domínio>`). Trocar o domínio gera um desafio novo e zera a verificação.
- **Login restrito ao endereço:** se o `host` do login aponta para uma clínica, só usuários dela entram. Com outra clínica, a resposta é `401` genérico.

## Acesso: usuários, papéis e permissões

- Cada usuário tem **um papel**, e cada papel, um conjunto de **permissões** do catálogo global:

| Permissão | Libera |
|---|---|
| `patients:read` / `patients:write` | Ver / criar, editar, remover e restaurar pacientes; preencher anamnese |
| `patients:export` | Exportar todos os dados de um paciente (LGPD) |
| `appointments:read` / `appointments:write` | Ver / mexer **na própria agenda** |
| `appointments:all` | Estende as duas acima à agenda de **todos** os profissionais |
| `anamnesis_templates:manage` | Criar, editar e apagar formulários de anamnese |
| `billing:read` / `billing:write` | Ver / operar cobranças e pagamentos |
| `users:manage` / `roles:manage` / `tenant:manage` | Usuários / papéis / dados, marca, domínio e encerramento da clínica |
| `audit:read` | Ver a trilha de auditoria |
| `platform:manage` | Painel da plataforma (nunca concedida a clínicas) |

- **Administrador** = usuário ativo com `users:manage` + `roles:manage` + `tenant:manage`. **A clínica sempre mantém pelo menos um** (`409`).
- **Sem escalada de privilégio** (`403`):
  - só se concede o que se tem;
  - ninguém altera usuário ou papel "acima" de si (com permissões que o ator não tem);
  - dá para se rebaixar, não para se promover.
- **Permissões relidas a cada requisição:** mudanças valem na hora.
- **Usuário:** status `active`, `invited` ou `disabled`. Só `active` loga. Não há exclusão de usuário, só desativação.
- **Convite:** criar usuário sem senha gera o convite (`invited` + email com link válido por 7 dias). O aceite define a senha, aceita os termos e ativa a conta. Reenviar invalida o link anterior.
- **Senha:**
  - troca exige a atual;
  - o admin pode redefinir a de outro usuário, mas não a própria nem a de quem está "acima";
  - "esqueci minha senha" sempre responde `204`, e o link vale 1 hora;
  - toda troca derruba as sessões abertas.

## Pacientes

- **CPF:** guardado só com dígitos e **único por clínica, inclusive entre removidos**. O conflito com um removido devolve `removedPatientId`, para o cliente oferecer "restaurar".
- **Remoção é soft delete:** some das leituras, mas fica no banco com as fichas. Pode ser restaurado. Paciente removido não recebe agendamento nem cobrança novos.
- **Busca** (`q`): todas as palavras precisam casar. Palavra com letras busca no nome (sem diferenciar maiúsculas nem acentos); palavra só com dígitos busca no CPF (parcial).
- `null` no `PATCH` limpa o campo.

## Anamnese

- Cada clínica define **formulários** com campos: chave em `snake_case`, rótulo, tipo (`text`, `textarea`, `number`, `boolean`, `date`, `select`, `multiselect`), obrigatório e opções (só para `select`/`multiselect`, e obrigatórias nesses dois).
- **Ficha** = respostas validadas contra o formulário (todos os erros juntos, `400`). **É imutável:** não há edição nem exclusão.
- Formulário já usado em alguma ficha não pode ser apagado (`409`). Editar é permitido, sem versionamento: fichas antigas ficam como foram salvas.

## Agenda

- **Duração:** com início e fim explícitos, ou só o início (o fim vem da duração do profissional ou, se ele não tiver, da clínica). A duração precisa respeitar o mínimo da clínica.
- **Sem sobreposição:** um profissional não pode ter dois agendamentos ativos (`scheduled`, `confirmed`, `completed`) com horários sobrepostos (`409`). Horários que só encostam são permitidos.
- **Transições de status:**
  - `scheduled` → `confirmed`, `completed`, `cancelled` ou `no_show`;
  - `confirmed` → `completed`, `cancelled` ou `no_show`;
  - `completed`, `cancelled` e `no_show` são finais: só as observações mudam.
- `DELETE` cancela, não apaga. Remarcar só o início mantém a duração.
- **Escopo:** sem `appointments:all`, o usuário só vê e mexe nos agendamentos em que ele é o profissional:
  - listar a agenda de outro → `403`;
  - abrir, editar ou cancelar agendamento de outro → `404`;
  - criar na agenda de outro, ou mover um agendamento para outro → `403`;
  - a lista de profissionais traz só ele mesmo.
- **Profissional** = qualquer usuário ativo da clínica.
- Listagem por janela `from`/`to` **por sobreposição** (entra quem ocupa algum instante da janela).

## Financeiro

- **Cobrança** de um paciente, com agendamento opcional, que precisa ser do mesmo paciente. Valor em centavos.
- **Status:** `pending` → `paid` (só por pagamento suficiente, nunca à mão) ou `cancelled`. "Atrasada" é calculado: pendente com vencimento antes de hoje (em UTC).
- Cobrança com **qualquer** pagamento registrado não pode mais ser editada nem cancelada.
- **Pagamentos** parciais ou totais: a soma nunca passa do valor (`400` com o saldo). Completar o valor marca a cobrança como paga.
- **Resumo:** pendente, atrasado e cancelado são o estado atual; pago é por período, pela data do pagamento.
- Emissão de nota fiscal (NFS-e) fica fora do escopo por enquanto.

## LGPD

- **Trilha de auditoria:** toda leitura e alteração de paciente e de ficha clínica, além de exportações e do encerramento de conta, é registrada com usuário, data, IP e navegador. As alterações guardam o valor antigo e o novo de cada campo. O conteúdo clínico nunca entra na trilha. **A trilha é imutável.** Só administradores (`audit:read`) consultam.
- **Termos e Política:** aceite obrigatório no cadastro e no aceite de convite, com versão, data, IP e navegador. Versão nova publicada → aceite pendente para todos, e o bloqueio é feito pelo front.
- **Direito de acesso do paciente:** exportação de tudo o que a clínica guarda sobre ele, num JSON legível, inclusive de paciente removido.
- **Saída da clínica:**
  - exportação completa;
  - pedido de encerramento com senha, seguido de carência de 30 dias (a clínica continua funcionando e pode cancelar);
  - depois da carência, a exclusão definitiva pela plataforma, confirmando o subdomínio, deixa só uma prova de exclusão.
  - A plataforma **nunca** apaga uma clínica sem o pedido dela.
- **Ainda não coberto:** apagar ou anonimizar um paciente a pedido dele (há obrigação de guarda de prontuário; depende de orientação jurídica).

## Painel da plataforma

- Lista e busca clínicas (com contagem de usuários e pacientes e o pedido de encerramento), suspende e reativa, e exclui definitivamente as clínicas que pediram, depois da carência.
- A clínica-plataforma não aparece na lista e não pode ser suspensa nem excluída.
- O primeiro admin é criado por script (`npm run bootstrap:platform`), nunca pelo cadastro público.
