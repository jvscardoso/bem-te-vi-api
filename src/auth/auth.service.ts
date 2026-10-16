import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantHostResolver } from '../tenants/tenant-host-resolver.js';
import { UserTokensService } from '../account/user-tokens.service.js';
import { AccountMailerService } from '../account/account-mailer.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { TokenPasswordDto } from './dto/token-password.dto.js';
import { AcceptInviteDto } from './dto/accept-invite.dto.js';
import { LegalService } from '../legal/legal.service.js';
import type { LegalAcceptanceDto } from '../legal/dto/legal-acceptance.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionsService } from './sessions.service.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import type { AuthenticatedUser, JwtPayload } from './types/auth.types.js';
import { subscriptionSummary } from '../subscriptions/subscription-access.js';

const SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Comparado quando o email não existe, para essa resposta custar o mesmo bcrypt que uma
  // senha errada — senão a diferença de tempo revelaria quais emails estão cadastrados.
  private readonly dummyHash = hash(randomUUID(), SALT_ROUNDS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly hostResolver: TenantHostResolver,
    private readonly tokens: UserTokensService,
    private readonly mailer: AccountMailerService,
    private readonly legal: LegalService,
    private readonly sessions: SessionsService,
    private readonly loginAttempts: LoginAttemptsService,
    private readonly audit: AuditService,
  ) {}

  // Sempre a mesma resposta (204), exista ou não a conta: a busca, o token e o email rodam em
  // segundo plano, então nem a resposta nem o tempo dela revelam se o email está cadastrado.
  // Só contas que conseguiriam logar recebem o link: ativas, de clínica ativa e — se o pedido
  // veio pelo endereço de uma clínica — dessa clínica (mesma regra do login).
  forgotPassword(dto: ForgotPasswordDto) {
    this.mailer.dispatch(this.sendPasswordReset(dto), 'recuperação de senha');
  }

  private async sendPasswordReset({ email, host }: ForgotPasswordDto) {
    const [user, hostTenantId] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: { id: true, name: true, email: true, tenantId: true, status: true, tenant: { select: { status: true } } },
      }),
      host ? this.hostResolver.findActiveTenantId(host) : null,
    ]);
    if (
      !user ||
      user.status !== 'active' ||
      user.tenant.status !== 'active' ||
      (hostTenantId !== null && hostTenantId !== user.tenantId)
    ) {
      return;
    }
    const token = await this.tokens.issue(user.id, 'password_reset');
    await this.mailer.sendPasswordReset(user, token);
  }

  // Troca a senha e derruba todas as sessões (passwordVersion), como a troca autenticada.
  // Devolve o email para o frontend preencher o login em seguida. Quem abriu o link provou ser
  // dono da conta: o bloqueio por tentativas (de outra pessoa, talvez) não vale mais para ele.
  async resetPassword(dto: TokenPasswordDto) {
    const passwordHash = await hash(dto.password, SALT_ROUNDS);
    const result = await this.prisma.$transaction(async (tx) => {
      const userId = await this.tokens.consume(tx, dto.token, 'password_reset');
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { status: true, email: true, tenant: { select: { status: true } } },
      });
      // Desativado ou clínica suspensa depois do pedido: o link deixa de valer.
      if (user.status !== 'active' || user.tenant.status !== 'active') {
        this.tokens.invalid();
      }
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordVersion: { increment: 1 } },
      });
      await this.sessions.revokeAllForUser(tx, userId);
      return { email: user.email };
    });
    await this.loginAttempts.clear(result.email);
    return result;
  }

  // Convidado define a própria senha e a conta passa a `active`. Só vale para quem ainda está
  // `invited`: um convite antigo não reativa uma conta desativada depois.
  async acceptInvite(dto: AcceptInviteDto) {
    // Versão desatualizada é 400 antes de gastar o token (a pessoa recarrega a tela e tenta de novo).
    this.legal.assertCurrent(dto.legalAcceptance);
    const passwordHash = await hash(dto.password, SALT_ROUNDS);
    return this.prisma.$transaction(async (tx) => {
      const userId = await this.tokens.consume(tx, dto.token, 'invite');
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, tenantId: true, status: true, email: true },
      });
      if (user.status !== 'invited') {
        this.tokens.invalid();
      }
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, status: 'active', passwordVersion: { increment: 1 } },
      });
      await this.sessions.revokeAllForUser(tx, userId);
      await this.legal.record(tx, user, dto.legalAcceptance);
      return { email: user.email };
    });
  }

  // Devolve também o refresh token, que o controller põe no cookie (nunca no corpo).
  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    // Em paralelo: resolver o host custa o mesmo para qualquer email, então não muda o tempo
    // de resposta conforme a clínica do usuário.
    const [user, hostTenantId, locked] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email },
        include: {
          tenant: { select: { status: true } },
          role: {
            include: { permissions: { include: { permission: true } } },
          },
        },
      }),
      dto.host ? this.hostResolver.findActiveTenantId(dto.host) : null,
      this.loginAttempts.isLocked(email),
    ]);

    const passwordMatches = await compare(dto.password, user?.passwordHash ?? (await this.dummyHash));

    // Mensagem genérica em todos os casos (email inexistente, senha errada, conta desabilitada,
    // tenant suspenso, usuário de outra clínica, conta bloqueada por tentativas) para não dar
    // pista a quem está tentando enumerar contas — nem em qual clínica um email está cadastrado.
    // Clínica do host: o endereço exibe a marca dela (GET /public/branding resolve igual), então
    // só usuários dela entram por ali. Host sem clínica (domínio da plataforma, desconhecido)
    // ou ausente não restringe.
    if (
      locked ||
      !user ||
      !passwordMatches ||
      user.status !== 'active' ||
      user.tenant.status !== 'active' ||
      (hostTenantId !== null && hostTenantId !== user.tenantId)
    ) {
      // Conta a falha pelo email digitado, exista a conta ou não (ver LoginAttemptsService).
      if (!locked && !passwordMatches && (await this.loginAttempts.recordFailure(email)) && user) {
        this.recordLock(user);
      }
      throw new UnauthorizedException('Credenciais inválidas');
    }

    await this.loginAttempts.clear(email);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const permissions = user.role.permissions.map((rp) => rp.permission.key);
    const { sessionId, refreshToken } = await this.sessions.start(user.id, user.passwordVersion);

    return {
      accessToken: await this.sign({
        sub: user.id,
        tenantId: user.tenantId,
        roleId: user.roleId,
        permissions,
        pwv: user.passwordVersion,
        sid: sessionId,
      }),
      refreshToken,
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

  // A clínica fica sabendo que alguém errou a senha de uma conta dela muitas vezes seguidas. Em
  // segundo plano: gravar só quando a conta existe não pode mudar o tempo da resposta.
  private recordLock(user: { id: string; tenantId: string }) {
    this.audit
      .record({ userId: user.id, tenantId: user.tenantId }, { action: 'auth.login_locked', entityType: 'user', entityId: user.id })
      .catch((error: unknown) => this.logger.error(`Falha ao auditar bloqueio de login: ${String(error)}`));
  }

  // Novo token de acesso a partir do refresh token (cookie). Confere de novo o que o login
  // confere: conta desativada, clínica suspensa ou senha trocada depois do login (por qualquer
  // caminho, inclusive a redefinição pelo admin) não renovam, e a sessão é encerrada.
  async refresh(token: string) {
    const rotated = await this.sessions.rotate(token);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: rotated.userId },
      select: {
        tenantId: true,
        roleId: true,
        status: true,
        passwordVersion: true,
        tenant: { select: { status: true } },
        role: { select: { permissions: { select: { permission: { select: { key: true } } } } } },
      },
    });
    if (
      user.status !== 'active' ||
      user.tenant.status !== 'active' ||
      user.passwordVersion !== rotated.passwordVersion
    ) {
      await this.sessions.revoke(rotated.sessionId);
      throw new UnauthorizedException('Sessão expirada; faça login novamente');
    }
    return {
      accessToken: await this.sign({
        sub: rotated.userId,
        tenantId: user.tenantId,
        roleId: user.roleId,
        permissions: user.role.permissions.map((rp) => rp.permission.key),
        pwv: user.passwordVersion,
        sid: rotated.sessionId,
      }),
      refreshToken: rotated.refreshToken,
    };
  }

  // Encerra a sessão pelo cookie e, se vier, pelo token de acesso (clientes sem cookie, como
  // scripts). O token de acesso pode estar vencido: só a assinatura importa para achar a sessão.
  // Nunca falha: sair de uma sessão que já acabou também é sair.
  async logout(refreshToken: string | undefined, accessToken: string | undefined) {
    if (refreshToken) {
      await this.sessions.revokeByRefreshToken(refreshToken);
    }
    if (accessToken) {
      const payload = await this.jwt
        .verifyAsync<JwtPayload>(accessToken, { ignoreExpiration: true })
        .catch(() => null);
      if (payload?.sid) {
        await this.sessions.revoke(payload.sid);
      }
    }
  }

  // Identidade + dados de exibição. As permissões vêm do request (já relidas do banco pelo
  // JwtStrategy); nome, email e papel são lidos aqui para o cliente não depender do que
  // guardou no login, que pode ter ficado velho.
  // `pendingLegalDocuments`: Termos/Política cuja versão vigente o usuário ainda não aceitou
  // (usuário criado com senha pelo admin, ou versão nova publicada). O frontend bloqueia o uso
  // até o aceite em POST /auth/me/legal-acceptances.
  async me({ sessionId: _sessionId, subscription: _timing, ...actor }: AuthenticatedUser) {
    const [user, pendingLegalDocuments] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: {
          name: true,
          email: true,
          role: { select: { id: true, name: true } },
          tenant: {
            select: {
              timezone: true,
              subscription: {
                select: { planId: true, status: true, trialEndsAt: true, pastDueSince: true, currentPeriodEnd: true },
              },
            },
          },
        },
      }),
      this.legal.pending(actor.userId),
    ]);
    // timezone: fuso da clínica, para o front mostrar horários e "hoje" como a clínica vê (só o
    // admin lê GET /tenants/:id, e todo usuário precisa disso).
    return {
      ...actor,
      name: user.name,
      email: user.email,
      role: user.role,
      timezone: user.tenant.timezone,
      pendingLegalDocuments,
      subscription: subscriptionSummary(user.tenant.subscription),
    };
  }

  async acceptLegal(actor: AuthenticatedUser, dto: LegalAcceptanceDto) {
    await this.legal.record(this.prisma, { id: actor.userId, tenantId: actor.tenantId }, dto);
    return { pendingLegalDocuments: await this.legal.pending(actor.userId) };
  }

  // Exige a senha atual: um token roubado sozinho não basta para tomar a conta.
  // A troca derruba as outras sessões e os tokens emitidos antes dela (ver JwtStrategy), então
  // devolve um token novo para quem acabou de trocar não ser deslogado junto. A sessão (e o
  // cookie de refresh) de quem trocou continua a mesma.
  async changePassword(actor: AuthenticatedUser, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { passwordHash: true },
    });
    // 400, não 401: 401 significa "sessão inválida" para o cliente, que deslogaria o usuário.
    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Senha atual incorreta');
    }

    const passwordHash = await hash(dto.newPassword, SALT_ROUNDS);
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: actor.userId },
        data: { passwordHash, passwordVersion: { increment: 1 } },
        select: { passwordVersion: true },
      });
      await this.sessions.keepOnlyAfterPasswordChange(tx, actor.userId, actor.sessionId, user.passwordVersion);
      return user;
    });

    return {
      accessToken: await this.sign({
        sub: actor.userId,
        tenantId: actor.tenantId,
        roleId: actor.roleId,
        permissions: actor.permissions,
        pwv: updated.passwordVersion,
        sid: actor.sessionId,
      }),
    };
  }

  private sign(payload: JwtPayload) {
    return this.jwt.signAsync(payload);
  }
}
