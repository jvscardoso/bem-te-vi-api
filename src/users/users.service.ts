import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessPolicyService, type Db } from '../access/access-policy.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdateAppointmentSettingsDto } from './dto/update-appointment-settings.dto.js';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccessPolicyService,
  ) {}

  async create(tenantId: string, actor: AuthenticatedUser, dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(`Já existe um usuário com o email ${email}`);
    }

    // O FK do banco só garante que a role existe, não que é do mesmo tenant.
    const roleKeys = await this.policy.roleKeys(this.prisma, tenantId, dto.roleId);
    if (!roleKeys) {
      throw new BadRequestException('roleId inválido para este tenant');
    }
    this.policy.assertCanGrant(actor, roleKeys);
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

  async update(tenantId: string, actor: AuthenticatedUser, id: string, dto: UpdateUserDto) {
    await this.assertDurationMeetsTenantMin(tenantId, dto.defaultAppointmentDurationMinutes);
    // O login normaliza o email para minúsculas; gravar diferente tornaria a conta inacessível.
    if (dto.email) {
      dto.email = dto.email.toLowerCase();
    }

    const write = async (db: Db) => {
      const target = await db.user.findFirst({ where: { id, tenantId }, select: { roleId: true } });
      if (!target) {
        throw new NotFoundException(`Usuário ${id} não encontrado`);
      }

      // Ninguém altera um usuário "acima" de si (papel com permissões que o ator não tem);
      // alterar a si mesmo é sempre permitido, dentro das regras de concessão abaixo.
      if (id !== actor.userId) {
        const targetKeys = (await this.policy.roleKeys(db, tenantId, target.roleId)) ?? [];
        this.policy.assertCanManage(actor, targetKeys, 'usuário');
      }

      if (dto.roleId !== undefined && dto.roleId !== target.roleId) {
        const newKeys = await this.policy.roleKeys(db, tenantId, dto.roleId);
        if (!newKeys) {
          throw new BadRequestException('roleId inválido para este tenant');
        }
        this.policy.assertCanGrant(actor, newKeys);
      }

      return db.user.update({ where: { id }, data: dto, omit: { passwordHash: true } });
    };

    // Mudar papel ou status pode tirar o último administrador: nesse caso vale a guarda.
    const changesAccess = dto.roleId !== undefined || dto.status !== undefined;
    return changesAccess ? this.policy.withAdminGuard(tenantId, write) : write(this.prisma);
  }

  updateOwnAppointmentSettings(
    tenantId: string,
    actor: AuthenticatedUser,
    { defaultAppointmentDurationMinutes }: UpdateAppointmentSettingsDto,
  ) {
    return this.update(tenantId, actor, actor.userId, { defaultAppointmentDurationMinutes });
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
}
