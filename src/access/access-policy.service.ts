import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

export type Db = Prisma.TransactionClient;

// Quem tem todas estas é "administrador" do tenant: sem ao menos um usuário ativo assim,
// ninguém consegue mais gerenciar usuários, papéis nem a clínica (lockout).
export const MANAGEMENT_PERMISSIONS = ['users:manage', 'roles:manage', 'tenant:manage'] as const;

// Regras de conta que atravessam usuários e papéis:
//  1. sem escalada de privilégio: só se concede o que se possui, e não se altera
//     usuário/papel "acima" de si (com permissões que o ator não tem);
//  2. o tenant nunca fica sem administrador ativo.
@Injectable()
export class AccessPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  // Chaves de permissão do papel, ou null se o papel não existe neste tenant.
  async roleKeys(db: Db, tenantId: string, roleId: string): Promise<string[] | null> {
    const role = await db.role.findFirst({
      where: { id: roleId, tenantId },
      select: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    return role ? role.permissions.map((rp) => rp.permission.key) : null;
  }

  // Converte ids do catálogo em chaves; id inexistente é erro do cliente (400), não do banco.
  async permissionKeysByIds(db: Db, ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }
    const found = await db.permission.findMany({
      where: { id: { in: ids } },
      select: { key: true },
    });
    if (found.length !== new Set(ids).size) {
      throw new BadRequestException('permissionIds contém permissão inexistente');
    }
    return found.map((permission) => permission.key);
  }

  // O ator só concede permissões que ele mesmo tem.
  assertCanGrant(actor: AuthenticatedUser, keys: string[]) {
    const missing = this.missing(actor, keys);
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Você não pode conceder permissões que não possui: ${missing.join(', ')}`,
      );
    }
  }

  // O ator não altera usuário/papel cujo papel tem permissões que ele não tem (alguém "acima").
  assertCanManage(actor: AuthenticatedUser, targetKeys: string[], subject: 'usuário' | 'papel') {
    if (this.missing(actor, targetKeys).length > 0) {
      throw new ForbiddenException(
        `Você não pode alterar um ${subject} com permissões que você não possui`,
      );
    }
  }

  // Roda `work` numa transação serializada por tenant e desfaz tudo se ela deixar o tenant
  // sem administrador ativo. O lock evita que dois admins se rebaixem ao mesmo tempo, cada um
  // enxergando o outro ainda ativo. Se o tenant já estava sem admin antes, não bloqueia.
  withAdminGuard<T>(tenantId: string, work: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tenant-admins:${tenantId}`}))`;

      const before = await this.countAdmins(tx, tenantId);
      const result = await work(tx);
      const after = await this.countAdmins(tx, tenantId);

      if (before > 0 && after === 0) {
        throw new ConflictException(
          `O tenant precisa manter ao menos um administrador ativo (${MANAGEMENT_PERMISSIONS.join(', ')})`,
        );
      }
      return result;
    });
  }

  private countAdmins(db: Db, tenantId: string) {
    return db.user.count({
      where: {
        tenantId,
        status: 'active',
        AND: MANAGEMENT_PERMISSIONS.map((key) => ({
          role: { permissions: { some: { permission: { key } } } },
        })),
      },
    });
  }

  private missing(actor: AuthenticatedUser, keys: string[]) {
    const granted = new Set(actor.permissions);
    return keys.filter((key) => !granted.has(key));
  }
}
