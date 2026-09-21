import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser, JwtPayload } from '../types/auth.types.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // O token só prova identidade: usuário, tenant e permissões são relidos do banco a cada
  // request (uma query por PK). Assim, desativar um usuário, suspender um tenant ou mudar
  // um papel tem efeito imediato, sem esperar o token expirar.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        tenantId: true,
        roleId: true,
        status: true,
        tenant: { select: { status: true } },
        role: { select: { permissions: { select: { permission: { select: { key: true } } } } } },
      },
    });

    if (!user || user.status !== 'active' || user.tenant.status !== 'active') {
      throw new UnauthorizedException();
    }

    return {
      userId: payload.sub,
      tenantId: user.tenantId,
      roleId: user.roleId,
      permissions: user.role.permissions.map((rp) => rp.permission.key),
    };
  }
}
