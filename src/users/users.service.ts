import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserTokensService } from '../account/user-tokens.service.js';
import { AccountMailerService } from '../account/account-mailer.service.js';
import { AccessPolicyService, type Db } from '../access/access-policy.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdateAppointmentSettingsDto } from './dto/update-appointment-settings.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { pageOf } from '../common/pagination/page.js';
import { USER_SECRET_FIELDS } from '../common/user-secret-fields.js';
import { APPOINTMENTS_ALL } from '../appointments/appointments-scope.js';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccessPolicyService,
    private readonly tokens: UserTokensService,
    private readonly mailer: AccountMailerService,
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

    // Convidado ganha uma senha aleatória que ninguém conhece (a coluna é obrigatória); ela é
    // substituída quando ele aceita o convite. Enquanto `invited`, o login recusa de todo jeito.
    const invite = dto.password === undefined;
    const passwordHash = await hash(dto.password ?? randomBytes(32).toString('hex'), SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        roleId: dto.roleId,
        name: dto.name,
        email,
        passwordHash,
        status: invite ? 'invited' : 'active',
        defaultAppointmentDurationMinutes: dto.defaultAppointmentDurationMinutes,
      },
      omit: USER_SECRET_FIELDS,
    });
    if (invite) {
      await this.sendInvite(user);
    }
    return user;
  }

  // Reenvia o convite (email perdido, expirado). O link anterior deixa de valer.
  async resendInvite(tenantId: string, actor: AuthenticatedUser, id: string) {
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, email: true, tenantId: true, roleId: true, status: true },
    });
    if (!target) {
      throw new NotFoundException(`Usuário ${id} não encontrado`);
    }
    const targetKeys = (await this.policy.roleKeys(this.prisma, tenantId, target.roleId)) ?? [];
    this.policy.assertCanManage(actor, targetKeys, 'usuário');
    if (target.status !== 'invited') {
      throw new ConflictException('Só é possível reenviar o convite de um usuário com status invited');
    }
    await this.sendInvite(target);
  }

  // O token é gravado antes de responder; o email segue em segundo plano (falha fica no log e
  // o admin pode reenviar).
  private async sendInvite(user: { id: string; name: string; email: string; tenantId: string }) {
    const token = await this.tokens.issue(user.id, 'invite');
    this.mailer.dispatch(this.mailer.sendInvite(user, token), `convite para ${user.email}`);
  }

  // Ordem por nome com desempate por id, para as páginas não repetirem nem pularem usuários.
  async findAll(tenantId: string, { page, pageSize }: ListUsersQueryDto) {
    const where = { tenantId };
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        omit: USER_SECRET_FIELDS,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return pageOf(data, total, page, pageSize);
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      omit: USER_SECRET_FIELDS,
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

      return db.user.update({ where: { id }, data: dto, omit: USER_SECRET_FIELDS });
    };

    // Mudar papel ou status pode tirar o último administrador: nesse caso vale a guarda.
    const changesAccess = dto.roleId !== undefined || dto.status !== undefined;
    return changesAccess ? this.policy.withAdminGuard(tenantId, write) : write(this.prisma);
  }

  // Redefinição pelo administrador (usuário esqueceu a senha, conta comprometida). Derruba as
  // sessões abertas do alvo (passwordVersion, ver JwtStrategy). Para a própria senha, o
  // caminho é PATCH /auth/me/password, que exige a senha atual — senão um token roubado de um
  // admin bastaria para trocar a senha dele e tomar a conta.
  async resetPassword(tenantId: string, actor: AuthenticatedUser, id: string, password: string) {
    if (id === actor.userId) {
      throw new BadRequestException(
        'Para trocar a própria senha, use PATCH /auth/me/password (exige a senha atual)',
      );
    }
    const target = await this.prisma.user.findFirst({ where: { id, tenantId }, select: { roleId: true } });
    if (!target) {
      throw new NotFoundException(`Usuário ${id} não encontrado`);
    }
    const targetKeys = (await this.policy.roleKeys(this.prisma, tenantId, target.roleId)) ?? [];
    this.policy.assertCanManage(actor, targetKeys, 'usuário');

    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await hash(password, SALT_ROUNDS), passwordVersion: { increment: 1 } },
    });
  }

  // Quem pode ser escolhido como profissional num agendamento: usuários ativos (é o mesmo
  // critério que AppointmentsService aplica). Campos mínimos, para liberar a quem só tem
  // acesso à agenda sem expor email/status/papel. A duração efetiva evita que o cliente
  // precise ler as configurações da clínica (que exigem tenant:manage) para prever o fim.
  // Sem appointments:all, a lista é só o próprio usuário: é a única agenda que ele pode usar.
  async findProfessionals(tenantId: string, actor: AuthenticatedUser) {
    const ownOnly = !actor.permissions.includes(APPOINTMENTS_ALL);
    const [tenant, users] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { defaultAppointmentDurationMinutes: true },
      }),
      this.prisma.user.findMany({
        where: { tenantId, status: 'active', ...(ownOnly ? { id: actor.userId } : {}) },
        select: { id: true, name: true, defaultAppointmentDurationMinutes: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return users.map((user) => ({
      ...user,
      effectiveAppointmentDurationMinutes:
        user.defaultAppointmentDurationMinutes ?? tenant.defaultAppointmentDurationMinutes,
    }));
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
