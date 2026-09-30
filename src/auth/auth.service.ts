import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import type { AuthenticatedUser, JwtPayload } from './types/auth.types.js';

const SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: {
        tenant: { select: { status: true } },
        role: {
          include: { permissions: { include: { permission: true } } },
        },
      },
    });

    // Mensagem genérica em ambos os casos (email inexistente, senha errada,
    // conta desabilitada, tenant suspenso) para não dar pista a quem está tentando enumerar contas.
    if (!user || user.status !== 'active' || user.tenant.status !== 'active') {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const passwordMatches = await compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const permissions = user.role.permissions.map((rp) => rp.permission.key);

    return {
      accessToken: await this.sign({
        sub: user.id,
        tenantId: user.tenantId,
        roleId: user.roleId,
        permissions,
        pwv: user.passwordVersion,
      }),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        tenantId: user.tenantId,
        roleId: user.roleId,
        permissions,
      },
    };
  }

  // Identidade + dados de exibição. As permissões vêm do request (já relidas do banco pelo
  // JwtStrategy); nome, email e papel são lidos aqui para o cliente não depender do que
  // guardou no login, que pode ter ficado velho.
  async me(actor: AuthenticatedUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { name: true, email: true, role: { select: { id: true, name: true } } },
    });
    return { ...actor, name: user.name, email: user.email, role: user.role };
  }

  // Exige a senha atual: um token roubado sozinho não basta para tomar a conta.
  // A troca derruba todas as sessões (ver JwtStrategy), então devolve um token novo para
  // quem acabou de trocar não ser deslogado junto.
  async changePassword(actor: AuthenticatedUser, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { passwordHash: true },
    });
    // 400, não 401: 401 significa "sessão inválida" para o cliente, que deslogaria o usuário.
    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Senha atual incorreta');
    }

    const updated = await this.prisma.user.update({
      where: { id: actor.userId },
      data: {
        passwordHash: await hash(dto.newPassword, SALT_ROUNDS),
        passwordVersion: { increment: 1 },
      },
      select: { passwordVersion: true },
    });

    return {
      accessToken: await this.sign({
        sub: actor.userId,
        tenantId: actor.tenantId,
        roleId: actor.roleId,
        permissions: actor.permissions,
        pwv: updated.passwordVersion,
      }),
    };
  }

  private sign(payload: JwtPayload) {
    return this.jwt.signAsync(payload);
  }
}
