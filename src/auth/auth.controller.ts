import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { TokenPasswordDto } from './dto/token-password.dto.js';
import { AcceptInviteDto } from './dto/accept-invite.dto.js';
import { LegalAcceptanceDto } from '../legal/dto/legal-acceptance.dto.js';
import { Public } from './decorators/public.decorator.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { AuthenticatedUser } from './types/auth.types.js';

// Rotas públicas sensíveis (login e fluxos por email) com o mesmo limite apertado: 5/min por IP.
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // O token de acesso vai no corpo (o front o guarda em memória); o refresh token, só no cookie.
  @Public()
  @Throttle(STRICT)
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { refreshToken, ...body } = await this.authService.login(dto);
    setRefreshCookie(res, refreshToken);
    return body;
  }

  // Token de acesso novo a partir do cookie, que é trocado junto (rotação). 401 apaga o cookie:
  // a sessão acabou e o front volta para o login. Fora o limite global (por IP): uma clínica
  // inteira atrás do mesmo IP renova a cada poucos minutos.
  @Public()
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req);
    try {
      if (!token) {
        throw new UnauthorizedException('Sessão expirada; faça login novamente');
      }
      const { accessToken, refreshToken } = await this.authService.refresh(token);
      if (refreshToken) {
        setRefreshCookie(res, refreshToken);
      }
      return { accessToken };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        clearRefreshCookie(res);
      }
      throw error;
    }
  }

  // Pública: precisa funcionar com o token de acesso já vencido. Encerra a sessão no servidor
  // (o token de acesso dela para de valer na hora) e apaga o cookie. Sempre 204.
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const bearer = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    await this.authService.logout(readRefreshCookie(req), bearer);
    clearRefreshCookie(res);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user);
  }

  // Mesmo limite do login: a senha atual é tentável por quem tiver um token roubado.
  @Throttle(STRICT)
  @Patch('me/password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user, dto);
  }

  // Aceite de uma versão nova dos Termos/Política (ver pendingLegalDocuments em GET /auth/me).
  @HttpCode(HttpStatus.OK)
  @Post('me/legal-acceptances')
  acceptLegal(@CurrentUser() user: AuthenticatedUser, @Body() dto: LegalAcceptanceDto) {
    return this.authService.acceptLegal(user, dto);
  }

  // 204 sempre, exista ou não a conta (não serve para descobrir emails cadastrados). O limite
  // também evita usar a rota para encher a caixa de alguém de emails.
  @Public()
  @Throttle(STRICT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    this.authService.forgotPassword(dto);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  resetPassword(@Body() dto: TokenPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  @Post('accept-invite')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto);
  }
}
