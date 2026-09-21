import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { UpdateTenantBrandingDto } from './dto/update-tenant-branding.dto.js';

const SALT_ROUNDS = 12;
const OWNER_ROLE_NAME = 'Admin';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create({ owner, ...tenantData }: CreateTenantDto) {
    const email = owner.email.toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException(`Já existe um usuário com o email ${email}`);
    }

    const passwordHash = await hash(owner.password, SALT_ROUNDS);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: tenantData });
      // Confere com os valores efetivos (inclui os defaults do schema); lançar aqui desfaz a transação.
      this.assertDurationSettings(
        tenant.defaultAppointmentDurationMinutes,
        tenant.minAppointmentDurationMinutes,
      );

      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          name: OWNER_ROLE_NAME,
          description: 'Acesso total ao tenant, criada automaticamente no cadastro',
        },
      });

      const permissions = await tx.permission.findMany({ select: { id: true } });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map(({ id }) => ({ roleId: role.id, permissionId: id })),
        });
      }

      const ownerUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          roleId: role.id,
          name: owner.name,
          email,
          passwordHash,
        },
        omit: { passwordHash: true },
      });

      return { tenant, role: { id: role.id, name: role.name }, owner: ownerUser };
    });
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: { branding: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} não encontrado`);
    }
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    const tenant = await this.findOne(id);
    this.assertDurationSettings(
      dto.defaultAppointmentDurationMinutes ?? tenant.defaultAppointmentDurationMinutes,
      dto.minAppointmentDurationMinutes ?? tenant.minAppointmentDurationMinutes,
    );

    if (dto.minAppointmentDurationMinutes !== undefined) {
      const belowMin = await this.prisma.user.count({
        where: {
          tenantId: id,
          defaultAppointmentDurationMinutes: { lt: dto.minAppointmentDurationMinutes },
        },
      });
      if (belowMin > 0) {
        throw new BadRequestException(
          `${belowMin} profissional(is) têm duração padrão menor que o novo mínimo de ${dto.minAppointmentDurationMinutes} minutos`,
        );
      }
    }

    return this.prisma.tenant.update({ where: { id }, data: dto });
  }

  async updateBranding(id: string, dto: UpdateTenantBrandingDto) {
    await this.findOne(id);
    return this.prisma.tenantBranding.upsert({
      where: { tenantId: id },
      create: { tenantId: id, ...dto },
      update: dto,
    });
  }

  private assertDurationSettings(defaultMinutes: number, minMinutes: number) {
    if (defaultMinutes < minMinutes) {
      throw new BadRequestException(
        'A duração padrão do atendimento não pode ser menor que a duração mínima',
      );
    }
  }
}
