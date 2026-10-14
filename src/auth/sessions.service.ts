import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestContext } from '../common/request-context/request-context.js';
import type { Db } from '../access/access-policy.service.js';

// Prazos da sessão. O token de acesso é curto (JWT_EXPIRES_IN, 15 min) e o front o renova com o
// refresh token enquanto estiver aberto. O refresh sem uso por 12 h vence (navegador fechado,
// computador desligado), e a sessão inteira dura no máximo 24 h, o mesmo teto do token de 1 dia
// de antes: depois disso, login de novo.
const REFRESH_IDLE_MS = 12 * 60 * 60 * 1000;
const SESSION_MAX_MS = 24 * 60 * 60 * 1000;
// Duas abas renovando ao mesmo tempo mandam o mesmo cookie; a segunda chega com o token que a
// primeira acabou de trocar. Dentro desta janela, isso é tratado como corrida, não como roubo.
const REUSE_GRACE_MS = 10_000;

const SESSION_ENDED = 'Sessão expirada; faça login novamente';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface RotatedSession {
  sessionId: string;
  userId: string;
  // Versão da senha em que a sessão nasceu (o AuthService confere com a atual).
  passwordVersion: number;
  // Token novo para o cookie, ou null na corrida entre abas (o cookie já tem o mais recente).
  refreshToken: string | null;
}

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  // Abre uma sessão no login. Aproveita para apagar as sessões vencidas do usuário: assim a
  // tabela não cresce sem limite e não precisa de uma tarefa agendada só para isso.
  async start(userId: string, passwordVersion: number): Promise<{ sessionId: string; refreshToken: string }> {
    const { ip, userAgent } = RequestContext.current();
    return this.prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
      const session = await tx.session.create({
        data: { userId, passwordVersion, expiresAt: new Date(Date.now() + SESSION_MAX_MS), ip, userAgent },
        select: { id: true, expiresAt: true },
      });
      return { sessionId: session.id, refreshToken: await this.issueToken(tx, session.id, session.expiresAt) };
    });
  }

  // Troca o refresh token por um novo (rotação). Token desconhecido, vencido ou de sessão
  // encerrada: 401. Token já trocado, fora da janela da corrida entre abas: alguém tem uma cópia
  // dele, então a sessão é encerrada (o dono também cai, mas quem copiou perde o acesso).
  async rotate(token: string): Promise<RotatedSession> {
    const now = new Date();
    const found = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        expiresAt: true,
        usedAt: true,
        session: { select: { id: true, userId: true, passwordVersion: true, expiresAt: true, revokedAt: true } },
      },
    });
    if (!found || found.session.revokedAt || found.session.expiresAt <= now) {
      throw new UnauthorizedException(SESSION_ENDED);
    }
    const { session } = found;
    const identity = { sessionId: session.id, userId: session.userId, passwordVersion: session.passwordVersion };
    if (found.usedAt) {
      if (now.getTime() - found.usedAt.getTime() <= REUSE_GRACE_MS) {
        return { ...identity, refreshToken: null };
      }
      await this.revoke(session.id);
      throw new UnauthorizedException(SESSION_ENDED);
    }
    if (found.expiresAt <= now) {
      throw new UnauthorizedException(SESSION_ENDED);
    }

    return this.prisma.$transaction(async (tx) => {
      // Condicional: de duas trocas simultâneas do mesmo token, só uma gera token novo.
      const consumed = await tx.refreshToken.updateMany({
        where: { id: found.id, usedAt: null },
        data: { usedAt: now },
      });
      if (consumed.count === 0) {
        return { ...identity, refreshToken: null };
      }
      await tx.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
      const refreshToken = await this.issueToken(tx, session.id, session.expiresAt);
      return { ...identity, refreshToken };
    });
  }

  async revoke(sessionId: string, db: Db = this.prisma) {
    await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // Logout pelo cookie: encerra a sessão dona do token, usado ou não. Token desconhecido não é
  // erro (o logout é idempotente).
  async revokeByRefreshToken(token: string) {
    const found = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { sessionId: true },
    });
    if (found) {
      await this.revoke(found.sessionId);
    }
  }

  // Troca ou redefinição de senha: derruba as sessões abertas do usuário (inclusive a de quem
  // tinha a senha antiga). Mesmo sem isto, o refresh já recusaria essas sessões pela versão da
  // senha; encerrar aqui deixa o banco dizendo a verdade (e vale para o token de acesso na hora).
  async revokeAllForUser(db: Db, userId: string) {
    await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // Troca da própria senha: encerra as outras sessões e mantém a de quem trocou, que passa a
  // valer para a versão nova da senha.
  async keepOnlyAfterPasswordChange(db: Db, userId: string, sessionId: string, passwordVersion: number) {
    await db.session.updateMany({
      where: { userId, revokedAt: null, id: { not: sessionId } },
      data: { revokedAt: new Date() },
    });
    await db.session.update({ where: { id: sessionId }, data: { passwordVersion } });
  }

  // O refresh vence com o prazo de inatividade, mas nunca depois do prazo máximo da sessão.
  private async issueToken(db: Db, sessionId: string, sessionExpiresAt: Date): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Math.min(Date.now() + REFRESH_IDLE_MS, sessionExpiresAt.getTime()));
    await db.refreshToken.create({ data: { sessionId, tokenHash: hashToken(token), expiresAt } });
    return token;
  }
}
