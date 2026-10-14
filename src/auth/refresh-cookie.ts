import type { Request, Response } from 'express';

export const REFRESH_COOKIE = 'btv_refresh';

// O refresh token vai num cookie que o JavaScript da página não lê (HttpOnly): um script
// injetado por XSS no front não consegue copiá-lo.
// - SameSite=Strict: o navegador só o manda em requisição vinda do próprio site (o front em
//   <clínica>.<domínio base> e a API em api.<domínio base> são o mesmo site). Isso fecha o CSRF:
//   outro site não consegue disparar /auth/refresh nem /auth/logout com o cookie da vítima.
// - Sem Path, de propósito: o navegador usa o "diretório" da rota que criou o cookie. Chamada
//   direto, a API recebe /auth/login e o cookie vale para /auth; atrás de um proxy no domínio
//   da clínica (agenda.clinica.com.br/api → API), o navegador vê /api/auth/login e o cookie vale
//   para /api/auth. Um Path fixo quebraria um dos dois. (Por isso o header é montado aqui: o
//   res.cookie do Express sempre põe Path=/, que mandaria o cookie para o site inteiro.)
// - Sem Max-Age: cookie de sessão do navegador, que some quando o navegador fecha (como o
//   sessionStorage em que o front guardava o token). O prazo de verdade é o do banco.
// - Secure: só por HTTPS. AUTH_COOKIE_SECURE=false desliga para a stack local em http (o
//   Docker de dev roda com NODE_ENV=production); sem a variável, segue o NODE_ENV.
function attributes(): string {
  const configured = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  const secure = configured ? configured === 'true' : process.env.NODE_ENV === 'production';
  return `HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

// O token é base64url: não precisa de escape.
export function setRefreshCookie(res: Response, token: string) {
  res.append('Set-Cookie', `${REFRESH_COOKIE}=${token}; ${attributes()}`);
}

export function clearRefreshCookie(res: Response) {
  res.append('Set-Cookie', `${REFRESH_COOKIE}=; ${attributes()}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

// Leitura direta do header (a API não usa cookies em mais nada, então não vale um middleware).
export function readRefreshCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === REFRESH_COOKIE) {
      return part.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}
