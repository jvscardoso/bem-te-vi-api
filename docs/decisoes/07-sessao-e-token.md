# 07 · Sessão, logout e onde o front guarda o token

**Situação:** ✅ **Decidida em 14/10/2026** e implementada na API (task 19 de `docs/changes/`). Falta o front (task 21 em `../bem-te-vi-web/docs/changes/`).

## Como era

- Um JWT de 1 dia, sem refresh. O front o guardava no `sessionStorage`.
- O "Sair" do front só apagava o token do navegador: um token copiado continuava valendo até expirar.
- Se entrasse uma brecha de XSS no front, um script conseguia ler o token.

## Opções que estavam na mesa (task 19, itens 3 e 4)

| Item | Opções |
|---|---|
| Vida da sessão | **A.** Token curto + refresh rotativo e revogável · **B.** Token de 1 dia + `POST /auth/logout` · **C.** Manter e documentar o risco |
| Onde guardar o token | Bearer no `sessionStorage` (como era) · Cookie `HttpOnly` (mudança grande, exige CSRF e CORS com `credentials`) |

## Decisão

**A + logout, num modelo misto de Bearer e cookie:**

- **Token de acesso** (JWT) de **15 minutos**, enviado como `Authorization: Bearer`. O front o guarda **só em memória**: um script injetado que o achasse teria poucos minutos de uso.
- **Refresh token** num cookie `HttpOnly`, `Secure`, `SameSite=Strict`, sem `Path` (o navegador o limita às rotas `/auth`, ou `/api/auth` atrás de proxy), que o JavaScript da página não lê. É **rotativo**: cada uso gera outro, e um já usado reaparecendo (cópia) encerra a sessão inteira.
- **`POST /auth/logout`** encerra a sessão no servidor: o token de acesso dela passa a dar `401` na hora, sem esperar os 15 minutos.
- **Prazos:** o refresh vence com 12 h sem uso, e a sessão dura no máximo 24 h desde o login (o mesmo teto de 1 dia de antes). O cookie é de sessão do navegador (sem `Max-Age`): fechar o navegador encerra, como o `sessionStorage`.
- **CSRF:** o `SameSite=Strict` impede outro site de usar o cookie, e o CORS fechado (task 19, item 1) impede que outro site leia a resposta do refresh.

Os detalhes do contrato estão no README, seção "Autenticação e autorização".

## O que isso exige

### Do front (task 21)
- Guardar o token de acesso em memória, não mais no `sessionStorage`.
- No carregamento da página, chamar `POST /auth/refresh` para recuperar a sessão (o cookie sobrevive ao reload; a memória não).
- Renovar o token antes de ele vencer, ou ao receber `401`, uma vez, antes de deslogar.
- Mandar as requisições para a API com `credentials: 'include'` (ao menos as de `/auth/*`), senão o navegador não envia nem guarda o cookie.
- Chamar `POST /auth/logout` no "Sair".

### Da hospedagem (deploy)
- **O front e a API precisam ser o mesmo site** para o cookie `SameSite=Strict` funcionar:
  - Subdomínios: front em `<clínica>.<domínio base>` e API em `api.<domínio base>` são o mesmo site, e funciona sem nada extra.
  - **Domínio próprio de clínica** (`agenda.clinica.com.br`): a API em `api.<domínio base>` vira outro site, e o navegador não manda o cookie (o Safari já bloqueia cookies de terceiros, e outros navegadores vão no mesmo caminho). **A API precisa ser servida também no domínio da clínica**, por proxy (ex.: `agenda.clinica.com.br/api` → API). Isso cabe na mesma peça de infraestrutura que já falta para o HTTPS dos domínios próprios (ver `docs/status.md`, "Falta para lançar").
- `AUTH_COOKIE_SECURE`: vazio em produção (o cookie fica `Secure`). Só a stack local em http usa `false`.

## Para reavaliar

- **Domínio próprio sem proxy:** se a infraestrutura do item acima não sair, a alternativa é devolver o refresh token no corpo, para o front guardá-lo (perde a proteção contra XSS). Hoje não está implementado.
- **Inatividade na tela** (task 20 do front, item 3): é do front. O prazo de 12 h do servidor só vale quando nenhuma aba está aberta, porque o front renova sozinho enquanto está aberto.
- **Lista de sessões ativas** ("sair de todos os dispositivos"): o modelo `Session` já guarda IP, navegador e último uso. Falta só a rota, se o produto quiser.
