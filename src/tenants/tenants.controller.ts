import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { TenantsService } from './tenants.service.js';
import { TenantLogoService } from './tenant-logo.service.js';
import { TenantClosureService } from './tenant-closure.service.js';
import { RequestClosureDto } from './dto/request-closure.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { LOGO_MAX_BYTES } from './logo-image.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { UpdateTenantBrandingDto } from './dto/update-tenant-branding.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { TenantParam } from '../auth/decorators/tenant-param.decorator.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';

// O :id aqui É o tenantId (o tenant é o próprio recurso), por isso @TenantParam('id')
// no lugar do default 'tenantId' que os outros controllers (aninhados) usam.
@TenantParam('id')
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly logos: TenantLogoService,
    private readonly closure: TenantClosureService,
  ) {}

  // Signup público: cria o tenant + role "Admin" (todas as permissões) + usuário dono,
  // já que não existe ninguém autenticado ainda para fazer essas chamadas em sequência.
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @RequirePermissions('tenant:manage')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @RequirePermissions('tenant:manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @RequirePermissions('tenant:manage')
  @Patch(':id/branding')
  updateBranding(@Param('id') id: string, @Body() dto: UpdateTenantBrandingDto) {
    return this.tenantsService.updateBranding(id, dto);
  }

  // Upload do logo (multipart/form-data, campo "file"). Acima do limite, o multer responde 413.
  @RequirePermissions('tenant:manage')
  @Put(':id/branding/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES, files: 1 } }))
  uploadLogo(@Param('id') id: string, @UploadedFile() file?: { buffer: Buffer }) {
    return this.logos.upload(id, file);
  }

  @RequirePermissions('tenant:manage')
  @Delete(':id/branding/logo')
  removeLogo(@Param('id') id: string) {
    return this.logos.remove(id);
  }

  // Instruções (nome/valor do TXT) para o cliente provar que é dono do `customDomain`.
  @RequirePermissions('tenant:manage')
  @Get(':id/domain')
  getDomainVerification(@Param('id') id: string) {
    return this.tenantsService.getDomainVerification(id);
  }

  // Consulta o DNS agora; idempotente, sem corpo. 200 mesmo quando ainda não propagou
  // (a resposta descreve o estado, `verified: false` não é um erro de requisição).
  @RequirePermissions('tenant:manage')
  @HttpCode(HttpStatus.OK)
  @Post(':id/domain/verify')
  verifyDomain(@Param('id') id: string) {
    return this.tenantsService.verifyDomain(id);
  }

  // ---- Saída da clínica (LGPD) ----

  // Todos os dados da clínica num arquivo. Exige as duas permissões: é a base de pacientes e
  // prontuários inteira, então não basta gerenciar a clínica nem exportar um paciente.
  @RequirePermissions('tenant:manage', 'patients:export')
  @Header('Cache-Control', 'no-store')
  @Get(':id/export')
  async exportAll(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.closure.export(id, actor);
    const date = data.exportedAt.slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="clinica-${data.clinic.subdomain}-${date}.json"`);
    return data;
  }

  @RequirePermissions('tenant:manage')
  @Get(':id/closure')
  async getClosure(@Param('id') id: string) {
    const tenant = await this.tenantsService.findOne(id);
    return this.closure.closureView(tenant.closureRequestedAt);
  }

  @RequirePermissions('tenant:manage')
  @HttpCode(HttpStatus.OK)
  @Post(':id/closure')
  requestClosure(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: RequestClosureDto,
  ) {
    return this.closure.requestClosure(id, actor, dto.password);
  }

  @RequirePermissions('tenant:manage')
  @Delete(':id/closure')
  cancelClosure(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.closure.cancelClosure(id, actor);
  }
}
