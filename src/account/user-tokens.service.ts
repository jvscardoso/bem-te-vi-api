import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { UserTokenType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Db } from '../access/access-policy.service.js';

// Recuperar senha é sensível (quem tem o link troca a senha): validade curta. O convite precisa
// esperar a pessoa abrir o email, então dura mais.
const TTL_MS: Record<UserTokenType, number> = {
  password_reset: 60 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
};

const INVALID_TOKEN = 'Link inválido ou expirado';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class UserTokensService {
  constructor(private readonly prisma: PrismaService) {}

  // Gera um token novo e invalida os pendentes do mesmo tipo (só o link mais recente vale).
  // Devolve o token em claro, para ir no email; no banco fica só o hash.
  async issue(userId: string, type: UserTokenType): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.userToken.updateMany({
        where: { userId, type, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.userToken.create({
        data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TTL_MS[type]) },
      }),
    ]);
    return token;
  }

  // Consome o token dentro da transação do chamador: marca como usado só se ainda estiver
  // pendente (updateMany condicional), então dois envios simultâneos do mesmo link não passam
  // os dois. Token inexistente, de outro tipo, usado ou expirado: o mesmo 400.
  async consume(tx: Db, token: string, type: UserTokenType): Promise<string> {
    const tokenHash = hashToken(token);
    const consumed = await tx.userToken.updateMany({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BadRequestException(INVALID_TOKEN);
    }
    const { userId } = await tx.userToken.findUniqueOrThrow({ where: { tokenHash }, select: { userId: true } });
    return userId;
  }

  invalid(): never {
    throw new BadRequestException(INVALID_TOKEN);
  }
}
