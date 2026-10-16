# Página de cadastro de clínica (landing page)

**Para:** time da landing page · **Atualizado em:** 15/10/2026 · **Fonte:** API do bem-te-vi (`bem-te-vi-api`) e o documento técnico do app (`bem-te-vi-web/docs/cadastro-de-clinica-na-landing.md`).

A landing page passa a ser também a porta de entrada dos clientes: é nela que a clínica se cadastra. Este documento diz o que a página precisa ter, o contrato da API e o que fazer em cada erro.

## O que a página faz

1. A pessoa preenche os dados da clínica e os dela, e aceita os Termos de Uso e a Política de Privacidade.
2. A página chama a API e cria a clínica.
3. A clínica nasce em **teste grátis de 14 dias, no plano Essencial, sem cartão de crédito**. (O teste entra com a versão da API que traz a assinatura, prevista para o lançamento. O contrato do cadastro abaixo não muda por causa dela.)
4. A página mostra uma tela de sucesso com o link de login da clínica nova: `https://<subdomínio>.<domínio base>/login`.

**Não há login automático.** A sessão do sistema só nasce no login feito no endereço da própria clínica, então a pessoa entra com o email e a senha que acabou de cadastrar.

**O cadastro não escolhe plano.** Todo cadastro começa no teste do Essencial; a clínica contrata o plano depois, dentro do sistema. Os botões da tabela de preços ("Começar teste grátis") levam todos para esta mesma página. Se quiser saber de qual plano a pessoa veio, use um parâmetro na URL (ex.: `?plano=profissional`) só para analytics: a API não recebe esse dado.

## Desenho sugerido da página

Uma página só, com três blocos, nesta ordem:

**1. Sua clínica**
- **Nome da clínica** (ex.: "Clínica São José").
- **Endereço da clínica:** o subdomínio, preenchido sozinho a partir do nome, e editável. Mostre ao lado como vai ficar: `clinica-sao-jose.<domínio base>`.

**2. Seus dados** (quem cadastra vira o administrador da clínica)
- **Seu nome.**
- **Seu email:** será o login.
- **Senha** e **Confirme a senha.** A confirmação é só da página: a API não recebe esse campo.

**3. Aceite**
- Caixa de seleção: "Li e aceito os [Termos de Uso] e a [Política de Privacidade]", com os dois links abrindo os textos (ver "Termos e Política").

**Botão:** "Criar minha clínica — 14 dias grátis". Fica desabilitado até a caixa do aceite estar marcada e as versões dos documentos terem carregado.

**Abaixo do botão:** "Sem cartão de crédito. Depois do teste, escolha um plano a partir de R$ 99 por mês."

**Opções avançadas (recolhidas, opcionais):**
- **Fuso horário da clínica:** padrão "Horário de Brasília" (`America/Sao_Paulo`). Lista sugerida: Brasília (`America/Sao_Paulo`), Manaus (`America/Manaus`), Cuiabá (`America/Cuiaba`), Rio Branco (`America/Rio_Branco`), Fernando de Noronha (`America/Noronha`), Belém (`America/Belem`), Fortaleza (`America/Fortaleza`), Recife (`America/Recife`), Salvador (`America/Bahia`), Campo Grande (`America/Campo_Grande`), Porto Velho (`America/Porto_Velho`), Boa Vista (`America/Boa_Vista`).
- **Não** ofereça domínio próprio nem duração de atendimento no cadastro. O domínio próprio não está no plano Essencial (o do teste), e os dois se ajustam depois, dentro do sistema.

**Tela de sucesso:**
- "Sua clínica está pronta!"
- O endereço da clínica em destaque, com o botão "Entrar na minha clínica" levando para `https://<subdomínio>.<domínio base>/login`.
- "Você tem 14 dias grátis. Entre com o email e a senha que acabou de cadastrar."

## Contrato da API

As duas rotas são públicas (sem token). Endereço da API em produção: `https://api.<domínio base>` (a confirmar com quem faz o deploy).

**CORS:** a API só responde a origens conhecidas. Se a landing ficar fora do domínio base da plataforma (por exemplo, num domínio separado), a origem dela precisa ser incluída na variável `CORS_EXTRA_ORIGINS` da API. Avise quem faz o deploy.

### 1. Versões dos Termos e da Política

Chame ao abrir a página:

```http
GET /public/legal
```

```json
{ "terms": { "version": "1" }, "privacy": { "version": "1" } }
```

Guarde as duas versões: elas vão no cadastro, para provar qual versão a pessoa aceitou.

### 2. Criar a clínica

```http
POST /tenants
Content-Type: application/json
```

```json
{
  "name": "Clínica São José",
  "subdomain": "clinica-sao-jose",
  "timezone": "America/Sao_Paulo",
  "owner": { "name": "Maria Souza", "email": "maria@exemplo.com", "password": "********" },
  "legalAcceptance": { "termsVersion": "1", "privacyVersion": "1" }
}
```

| Campo | Obrigatório | Regra (valide na página antes de enviar) |
|---|---|---|
| `name` | Sim | Até 150 caracteres, sem ficar vazio nem só com espaços |
| `subdomain` | Sim | Até 63 caracteres; só letras minúsculas, números e hífen; **sem hífen no começo nem no fim**. Regex: `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$` |
| `timezone` | Não | Um dos fusos da lista acima. Padrão: `America/Sao_Paulo` |
| `owner.name` | Sim | Até 150 caracteres, sem ficar vazio nem só com espaços |
| `owner.email` | Sim | Email válido, até 150 caracteres |
| `owner.password` | Sim | De 8 a 200 caracteres |
| `legalAcceptance.termsVersion` / `privacyVersion` | Sim | As versões que vieram de `GET /public/legal` |

Não envie nenhum outro campo: campo desconhecido é recusado com `400`.

**Resposta `201`:** a clínica, o papel de administrador e o dono. Para a tela de sucesso, basta o `tenant.subdomain`:

```json
{
  "tenant": { "id": "…", "name": "Clínica São José", "subdomain": "clinica-sao-jose", "...": "..." },
  "role": { "id": "…", "name": "Admin" },
  "owner": { "id": "…", "name": "Maria Souza", "email": "maria@exemplo.com" }
}
```

### Sugestão de subdomínio a partir do nome

"Clínica São José" vira `clinica-sao-jose`:
1. tirar os acentos (`normalize('NFD')` e remover as marcas);
2. passar para minúsculas;
3. trocar tudo que não for `a-z` ou `0-9` por `-` (e juntar hífens repetidos);
4. cortar em 63 caracteres;
5. **só então** tirar os hífens do começo e do fim (cortar depois deixaria um hífen no fim, que a API recusa).

A sugestão para de acompanhar o nome assim que a pessoa edita o subdomínio à mão.

## Erros

O `400` de validação vem em português e diz o campo:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["Email do responsável inválido"],
  "errors": [{ "field": "owner.email", "code": "isEmail", "message": "Email do responsável inválido" }]
}
```

Use `errors[].field` para marcar o campo na tela e `errors[].message` como texto do erro. Os outros erros (`409`, regra de negócio) vêm só com `message` em texto.

| Status e mensagem | Quando | O que mostrar |
|---|---|---|
| `400` com `errors` | Algum campo fora das regras | A frase de cada erro embaixo do campo de `errors[].field` |
| `400` "Aceite a versão vigente dos Termos de Uso (…) e da Política de Privacidade (…)" | Os textos mudaram com a página aberta. Nada foi criado | Buscar `GET /public/legal` de novo, desmarcar o aceite e pedir que a pessoa aceite outra vez |
| `409` "Este subdomínio já está em uso" | Outra clínica usa esse endereço | No campo de endereço, sugerir outro (ex.: com a cidade) |
| `409` "Este subdomínio não está disponível" | Endereço reservado pela plataforma (`www`, `api`, `app`, `admin`…) | No campo de endereço. Não copie a lista de reservados para a página: ela muda por ambiente |
| `409` "Já existe um usuário com o email …" | Email já cadastrado em alguma clínica | No campo de email, com links "Entrar" e "Esqueci minha senha" |
| `429` | Mais de 10 cadastros por minuto do mesmo IP | "Muitas tentativas. Aguarde um minuto e tente de novo." |
| Sem resposta ou `5xx` | API fora do ar | "Não foi possível criar sua clínica agora. Tente de novo em instantes." Sem apagar o que a pessoa digitou |

## Termos e Política

- Os **textos** não vêm da API: estão no app, nas páginas `/termos` e `/privacidade`, no endereço principal da plataforma (sem clínica). A landing pode linkar para lá.
- Se a landing tiver cópias próprias dos textos, elas precisam ser das mesmas versões que `GET /public/legal` informa. Quando os textos mudarem, a versão sobe, e a página volta a pedir o aceite.

## Critérios de aceite

1. Um cadastro com dados válidos cria a clínica e leva à tela de sucesso, com o link de login no endereço dela.
2. O login com o email e a senha cadastrados funciona (e, com a versão da API que traz a assinatura, o sistema mostra o teste de 14 dias).
3. Cada erro da tabela aparece no campo certo, em português, sem apagar o que a pessoa digitou.
4. O botão fica desabilitado sem o aceite marcado.
5. O subdomínio é sugerido pelo nome e nunca é enviado com hífen no começo ou no fim.
6. Nenhum campo além dos da tabela é enviado.

## Para testar localmente

Com a API rodando em `http://localhost:3000`:

```bash
curl -X POST http://localhost:3000/tenants -H 'Content-Type: application/json' -d '{
  "name": "Clínica Teste", "subdomain": "clinica-teste",
  "owner": { "name": "Dono Teste", "email": "dono@clinica-teste.com", "password": "<senha de teste>" },
  "legalAcceptance": { "termsVersion": "1", "privacyVersion": "1" }
}'
```

Depois, o login fica em `http://clinica-teste.localhost:5173/login` (com o app rodando).

## O que pode mudar depois

- **Confirmação de email no cadastro** (em estudo): se for aprovada, a tela de sucesso passa a ser "confirme seu email" antes do primeiro login.
- **Login automático** depois do cadastro: hoje não existe. Exigiria uma mudança na API.
