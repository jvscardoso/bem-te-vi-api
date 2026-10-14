import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser, JwtPayload } from '../types/auth.types.js';

const SESSION_ENDED = 'Sessão encerrada; faça login novamente';

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
  // A sessão vem na mesma consulta: logout e troca de senha encerram a sessão no banco, e o token
  // dela para de valer na hora, mesmo faltando minutos para expirar.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sid) {
      throw new UnauthorizedException(SESSION_ENDED);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        tenantId: true,
        roleId: true,
        status: true,
        passwordVersion: true,
        tenant: { select: { status: true } },
        role: { select: { permissions: { select: { permission: { select: { key: true } } } } } },
        sessions: { where: { id: payload.sid }, select: { revokedAt: true, expiresAt: true } },
      },
    });

    if (!user || user.status !== 'active' || user.tenant.status !== 'active') {
      throw new UnauthorizedException();
    }
    // Token de antes da última troca/redefinição de senha.
    if ((payload.pwv ?? 0) !== user.passwordVersion) {
      throw new UnauthorizedException('Sessão encerrada pela troca de senha; faça login novamente');
    }
    const [session] = user.sessions;
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException(SESSION_ENDED);
    }

    return {
      userId: payload.sub,
      tenantId: user.tenantId,
      roleId: user.roleId,
      permissions: user.role.permissions.map((rp) => rp.permission.key),
      sessionId: payload.sid,
    };
  }
}
