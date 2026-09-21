import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdateAppointmentSettingsDto } from './dto/update-appointment-settings.dto.js';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(`Já existe um usuário com o email ${email}`);
    }

    await this.assertRoleInTenant(tenantId, dto.roleId);
    await this.assertDurationMeetsTenantMin(tenantId, dto.defaultAppointmentDurationMinutes);

    const passwordHash = await hash(dto.password, SALT_ROUNDS);
    return this.prisma.user.create({
      data: {
        tenantId,
        roleId: dto.roleId,
        name: dto.name,
        email,
        passwordHash,
        defaultAppointmentDurationMinutes: dto.defaultAppointmentDurationMinutes,
      },
      omit: { passwordHash: true },
    });
  }

  findAll(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      omit: { passwordHash: true },
    });
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      omit: { passwordHash: true },
    });
    if (!user) {
      throw new NotFoundException(`Usuário ${id} não encontrado`);
    }
    return user;
  }

  async update(tenantId: string, id: string, dto: UpdateUserDto) {
    await this.findOne(tenantId, id);
    if (dto.roleId) {
      await this.assertRoleInTenant(tenantId, dto.roleId);
    }
    await this.assertDurationMeetsTenantMin(tenantId, dto.defaultAppointmentDurationMinutes);
    return this.prisma.user.update({
      where: { id },
      data: dto,
      omit: { passwordHash: true },
    });
  }

  updateOwnAppointmentSettings(
    tenantId: string,
    userId: string,
    { defaultAppointmentDurationMinutes }: UpdateAppointmentSettingsDto,
  ) {
    return this.update(tenantId, userId, { defaultAppointmentDurationMinutes });
  }

  // A duração própria do profissional não pode ficar abaixo do mínimo da clínica.
  private async assertDurationMeetsTenantMin(tenantId: string, minutes?: number | null) {
    if (minutes == null) {
      return;
    }
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { minAppointmentDurationMinutes: true },
    });
    if (minutes < tenant.minAppointmentDurationMinutes) {
      throw new BadRequestException(
        `A duração mínima de atendimento desta clínica é de ${tenant.minAppointmentDurationMinutes} minutos`,
      );
    }
  }

  // O FK do banco só garante que a role existe, não que é do mesmo tenant.
  private async assertRoleInTenant(tenantId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId },
      select: { id: true },
    });
    if (!role) {
      throw new BadRequestException('roleId inválido para este tenant');
    }
  }
}
