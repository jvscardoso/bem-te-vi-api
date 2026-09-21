import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import type { JwtPayload } from './types/auth.types.js';

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
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      roleId: user.roleId,
      permissions,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
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
}
