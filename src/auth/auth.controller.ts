import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { TokenPasswordDto } from './dto/token-password.dto.js';
import { Public } from './decorators/public.decorator.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { AuthenticatedUser } from './types/auth.types.js';

// Rotas públicas sensíveis (login e fluxos por email) com o mesmo limite apertado: 5/min por IP.
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
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
  acceptInvite(@Body() dto: TokenPasswordDto) {
    return this.authService.acceptInvite(dto);
  }
}
