import { createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'supertest';
import {
  PASSWORD,
  cleanupTenants,
  createTestApp,
  createUser,
  signupTenant,
  uniq,
  type TestApp,
  type TestTenant,
} from './helpers/e2e.js';
import { REFRESH_COOKIE } from '../src/auth/refresh-cookie.js';
import { UserTokensService } from '../src/account/user-tokens.service.js';

// Cookie de refresh devolvido numa resposta ("btv_refresh=<token>; HttpOnly; ..."), ou undefined.
function refreshCookieOf(res: Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`));
}

// Só o "nome=valor", para mandar de volta no header Cookie.
const cookiePair = (setCookie: string) => setCookie.split(';')[0];

describe('Sessões: refresh token, logout e bloqueio por tentativas (e2e)', () => {
  let ctx: TestApp;
  let a: TestTenant;

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await signupTenant(ctx.http, 'sessao');
  });

  afterAll(async () => {
    await cleanupTenants(ctx.prisma, [a?.tenantId]);
    await ctx.app.close();
  });

  async function login(email: string, password = PASSWORD) {
    const res = await ctx.http().post('/auth/login').send({ email, password }).expect(200);
    const setCookie = refreshCookieOf(res)!;
    return {
      res,
      accessToken: res.body.accessToken as string,
      cookie: cookiePair(setCookie),
      setCookie,
    };
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const me = (token: string) => ctx.http().get('/auth/me').set(bearer(token));
  const refresh = (cookie?: string) => {
    const req = ctx.http().post('/auth/refresh');
    return cookie ? req.set('Cookie', cookie) : req;
  };

  describe('login', () => {
    it('põe o refresh token num cookie HttpOnly e SameSite=Strict, e nunca no corpo', async () => {
      const { res, setCookie } = await login(a.email);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Strict/i);
      // Sem Path: o navegador restringe o cookie ao "diretório" da rota (/auth, ou /api/auth
      // atrás de um proxy).
      expect(setCookie).not.toMatch(/Path=/i);
      // Fora de produção (e sem AUTH_COOKIE_SECURE), sem Secure.
      expect(setCookie).not.toMatch(/Secure/i);
      // Cookie de sessão do navegador: sem Max-Age nem Expires.
      expect(setCookie).not.toMatch(/Max-Age|Expires/i);
      expect(res.body.refreshToken).toBeUndefined();
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('AUTH_COOKIE_SECURE=true (ou produção) marca o cookie como Secure', async () => {
      process.env.AUTH_COOKIE_SECURE = 'true';
      try {
        const { setCookie } = await login(a.email);
        expect(setCookie).toMatch(/; Secure/);
      } finally {
        delete process.env.AUTH_COOKIE_SECURE;
      }
    });

    it('o token de acesso carrega o id da sessão', async () => {
      const { accessToken } = await login(a.email);
      const payload = ctx.app.get(JwtService).decode<{ sid: string }>(accessToken);
      expect(payload.sid).toEqual(expect.any(String));
    });

    it('GET /auth/me não expõe o id da sessão', async () => {
      const { accessToken } = await login(a.email);
      const res = await me(accessToken).expect(200);
      expect(res.body.sessionId).toBeUndefined();
    });
  });

  describe('POST /auth/refresh', () => {
    it('troca o cookie por um token de acesso novo e por um cookie novo (rotação)', async () => {
      const session = await login(a.email);
      const res = await refresh(session.cookie).expect(200);
      expect(res.body).toEqual({ accessToken: expect.any(String) });
      expect(res.headers['cache-control']).toBe('no-store');
      const rotated = refreshCookieOf(res)!;
      expect(cookiePair(rotated)).not.toBe(session.cookie);

      await me(res.body.accessToken).expect(200);
      // O cookie novo continua renovando.
      await refresh(cookiePair(rotated)).expect(200);
    });

    it('sem cookie ou com cookie desconhecido → 401 e apaga o cookie', async () => {
      await refresh().expect(401);
      const res = await refresh(`${REFRESH_COOKIE}=nao-existe`).expect(401);
      expect(refreshCookieOf(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it('corrida entre abas: o cookie recém-trocado ainda renova por alguns segundos, sem gerar outro', async () => {
      const session = await login(a.email);
      await refresh(session.cookie).expect(200);
      const again = await refresh(session.cookie).expect(200);
      await me(again.body.accessToken).expect(200);
      expect(refreshCookieOf(again)).toBeUndefined();
    });

    it('cookie já trocado, reapresentado depois da janela → 401 e a sessão inteira acaba (roubo)', async () => {
      const session = await login(a.email);
      const rotated = cookiePair(refreshCookieOf(await refresh(session.cookie).expect(200))!);
      // Simula o tempo passando: o token antigo foi usado há um minuto.
      const old = session.cookie.split('=')[1];
      await ctx.prisma.refreshToken.update({
        where: { tokenHash: sha256(old) },
        data: { usedAt: new Date(Date.now() - 60_000) },
      });

      await refresh(session.cookie).expect(401);
      // O dono legítimo (com o cookie mais novo) também cai, e o token de acesso da sessão também.
      await refresh(rotated).expect(401);
      await me(session.accessToken).expect(401);
    });

    it('sessão além do prazo máximo → 401', async () => {
      const session = await login(a.email);
      const { sid } = ctx.app.get(JwtService).decode<{ sid: string }>(session.accessToken);
      await ctx.prisma.session.update({ where: { id: sid }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await refresh(session.cookie).expect(401);
      await me(session.accessToken).expect(401);
    });

    it('refresh token vencido por inatividade → 401', async () => {
      const session = await login(a.email);
      await ctx.prisma.refreshToken.update({
        where: { tokenHash: sha256(session.cookie.split('=')[1]) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await refresh(session.cookie).expect(401);
    });

    it('usuário desativado não renova', async () => {
      const user = await createUser(ctx.http, a, 'sessao-desativado');
      const session = await login(user.email);
      await ctx
        .http()
        .patch(`/tenants/${a.tenantId}/users/${user.id}`)
        .set(a.auth)
        .send({ status: 'disabled' })
        .expect(200);
      await refresh(session.cookie).expect(401);
    });

    it('token sem sessão (emitido antes do refresh token) é recusado', async () => {
      const legacy = await ctx.app.get(JwtService).signAsync({
        sub: a.id,
        tenantId: a.tenantId,
        roleId: a.roleId,
        permissions: [],
        pwv: 0,
      });
      await me(legacy).expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('pelo cookie: o token de acesso da sessão para de valer na hora e o cookie não renova mais', async () => {
      const session = await login(a.email);
      await me(session.accessToken).expect(200);

      const res = await ctx.http().post('/auth/logout').set('Cookie', session.cookie).expect(204);
      expect(refreshCookieOf(res)).toMatch(/Expires=Thu, 01 Jan 1970/);

      await me(session.accessToken).expect(401);
      await refresh(session.cookie).expect(401);
    });

    it('pelo token de acesso (cliente sem cookie), mesmo vencido', async () => {
      const session = await login(a.email);
      await ctx.http().post('/auth/logout').set(bearer(session.accessToken)).expect(204);
      await me(session.accessToken).expect(401);
      await refresh(session.cookie).expect(401);

      // Token vencido, mas com assinatura válida: ainda identifica a sessão a encerrar.
      const other = await login(a.email);
      const jwt = ctx.app.get(JwtService);
      const payload = jwt.decode<Record<string, unknown>>(other.accessToken);
      const { exp: _exp, iat: _iat, ...claims } = payload;
      const expired = await jwt.signAsync(claims, { expiresIn: -10 });
      await ctx.http().post('/auth/logout').set(bearer(expired)).expect(204);
      await refresh(other.cookie).expect(401);
    });

    it('só encerra a própria sessão: as outras do mesmo usuário continuam', async () => {
      const first = await login(a.email);
      const second = await login(a.email);
      await ctx.http().post('/auth/logout').set('Cookie', first.cookie).expect(204);
      await me(second.accessToken).expect(200);
      await refresh(second.cookie).expect(200);
    });

    it('sem cookie nem token, ou com token inválido: 204 (idempotente)', async () => {
      await ctx.http().post('/auth/logout').expect(204);
      await ctx.http().post('/auth/logout').set(bearer('lixo.lixo.lixo')).expect(204);
    });
  });

  describe('troca de senha', () => {
    it('derruba as outras sessões e mantém a de quem trocou (token novo, mesmo cookie)', async () => {
      const user = await createUser(ctx.http, a, 'sessao-senha');
      const mine = await login(user.email);
      const other = await login(user.email);

      const res = await ctx
        .http()
        .patch('/auth/me/password')
        .set(bearer(mine.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'NovaSenha@123' })
        .expect(200);

      await me(res.body.accessToken).expect(200);
      await refresh(mine.cookie).expect(200);
      await me(other.accessToken).expect(401);
      await refresh(other.cookie).expect(401);
    });

    it('a redefinição pelo admin também derruba o refresh das sessões abertas', async () => {
      const user = await createUser(ctx.http, a, 'sessao-reset-admin');
      const session = await login(user.email);
      await ctx
        .http()
        .patch(`/tenants/${a.tenantId}/users/${user.id}/password`)
        .set(a.auth)
        .send({ password: 'OutraSenha@123' })
        .expect(204);
      await me(session.accessToken).expect(401);
      await refresh(session.cookie).expect(401);
    });
  });

  describe('bloqueio por tentativas na conta', () => {
    // Cada tentativa custa um bcrypt (custo 12): 10 a 20 logins passam do tempo padrão de 5 s.
    const SLOW = 60_000;
    const wrong = (email: string) =>
      ctx.http().post('/auth/login').send({ email, password: 'senha-errada' }).expect(401);

    it('10 senhas erradas bloqueiam a conta: nem a senha certa entra, com a mesma mensagem', async () => {
      const user = await createUser(ctx.http, a, 'bloqueio');
      const first = await wrong(user.email);
      for (let i = 1; i < 10; i++) {
        await wrong(user.email);
      }
      const blocked = await ctx.http().post('/auth/login').send({ email: user.email, password: PASSWORD }).expect(401);
      expect(blocked.body.message).toBe(first.body.message);
    }, SLOW);

    it('o bloqueio entra na trilha de auditoria da clínica', async () => {
      const user = await createUser(ctx.http, a, 'bloqueio-auditoria');
      for (let i = 0; i < 10; i++) {
        await wrong(user.email);
      }
      await vi.waitFor(async () => {
        const logs = await ctx.prisma.auditLog.findMany({
          where: { tenantId: a.tenantId, action: 'auth.login_locked', actorUserId: user.id },
        });
        expect(logs).toHaveLength(1);
      });
    }, SLOW);

    it('email inexistente passa pelo mesmo contador (não revela quais emails existem)', async () => {
      const email = `nao-existe-${uniq()}@teste.com`;
      for (let i = 0; i < 10; i++) {
        await wrong(email);
      }
      const row = await ctx.prisma.loginAttempt.findUnique({ where: { emailHash: sha256(email) } });
      expect(row?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    }, SLOW);

    it('acabado o bloqueio, a senha certa entra e zera o contador', async () => {
      const user = await createUser(ctx.http, a, 'bloqueio-fim');
      for (let i = 0; i < 10; i++) {
        await wrong(user.email);
      }
      await ctx.prisma.loginAttempt.update({
        where: { emailHash: sha256(user.email) },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      await login(user.email);
      expect(await ctx.prisma.loginAttempt.findUnique({ where: { emailHash: sha256(user.email) } })).toBeNull();
    }, SLOW);

    it('redefinir a senha pelo link do email tira o bloqueio (quem abriu o link é o dono)', async () => {
      const user = await createUser(ctx.http, a, 'bloqueio-reset');
      for (let i = 0; i < 10; i++) {
        await wrong(user.email);
      }
      const token = await ctx.app.get(UserTokensService).issue(user.id, 'password_reset');
      await ctx.http().post('/auth/reset-password').send({ token, password: 'NovaSenha@123' }).expect(200);
      await login(user.email, 'NovaSenha@123');
    }, SLOW);

    it('menos de 10 erros não bloqueiam, e o login certo zera a contagem', async () => {
      const user = await createUser(ctx.http, a, 'bloqueio-parcial');
      for (let i = 0; i < 9; i++) {
        await wrong(user.email);
      }
      await login(user.email);
      for (let i = 0; i < 9; i++) {
        await wrong(user.email);
      }
      await login(user.email);
    }, SLOW);
  });
});

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
