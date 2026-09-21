import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, { permissionIds, ...dto }: CreateRoleDto) {
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

  async update(tenantId: string, id: string, { permissionIds, ...dto }: UpdateRoleDto) {
    await this.findOne(tenantId, id);
    return this.prisma.role.update({
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
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.role.delete({ where: { id } });
  }
}
