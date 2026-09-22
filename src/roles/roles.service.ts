import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessPolicyService, type Db } from '../access/access-policy.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccessPolicyService,
  ) {}

  async create(tenantId: string, actor: AuthenticatedUser, { permissionIds, ...dto }: CreateRoleDto) {
    // Só se cria um papel com permissões que o próprio ator possui.
    const keys = await this.policy.permissionKeysByIds(this.prisma, permissionIds ?? []);
    this.policy.assertCanGrant(actor, keys);

    return this.prisma.role.create({
      data: {
        ...dto,
        tenantId,
        permissions: permissionIds
          ? { create: permissionIds.map((permissionId) => ({ permissionId })) }
          : undefined,
      },
      include: { permissions: { include: { permission: true } } },
    });
  }

  findAll(tenantId: string) {
    return this.prisma.role.findMany({
      where: { tenantId },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async findOne(tenantId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, tenantId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) {
      throw new NotFoundException(`Role ${id} não encontrada`);
    }
    return role;
  }

  async update(
    tenantId: string,
    actor: AuthenticatedUser,
    id: string,
    { permissionIds, ...dto }: UpdateRoleDto,
  ) {
    const write = async (db: Db) => {
      // Não edita papel "acima" do ator (com permissões que ele não tem)...
      const currentKeys = await this.policy.roleKeys(db, tenantId, id);
      if (!currentKeys) {
        throw new NotFoundException(`Role ${id} não encontrada`);
      }
      this.policy.assertCanManage(actor, currentKeys, 'papel');

      // ...e não concede permissões que não possui.
      if (permissionIds !== undefined) {
        this.policy.assertCanGrant(actor, await this.policy.permissionKeysByIds(db, permissionIds));
      }

      return db.role.update({
        where: { id },
        data: {
          ...dto,
          permissions:
            permissionIds !== undefined
              ? {
                  deleteMany: {},
                  create: permissionIds.map((permissionId) => ({ permissionId })),
                }
              : undefined,
        },
        include: { permissions: { include: { permission: true } } },
      });
    };

    // Trocar as permissões pode tirar o acesso administrativo do último admin: vale a guarda.
    return permissionIds !== undefined
      ? this.policy.withAdminGuard(tenantId, write)
      : write(this.prisma);
  }

  async remove(tenantId: string, actor: AuthenticatedUser, id: string) {
    const currentKeys = await this.policy.roleKeys(this.prisma, tenantId, id);
    if (!currentKeys) {
      throw new NotFoundException(`Role ${id} não encontrada`);
    }
    this.policy.assertCanManage(actor, currentKeys, 'papel');
    await this.prisma.role.delete({ where: { id } });
  }
}
