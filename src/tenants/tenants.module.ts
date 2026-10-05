import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { TenantsController } from './tenants.controller.js';
import { PublicBrandingController } from './public-branding.controller.js';
import { PublicBrandingService } from './public-branding.service.js';
import { PublicLogosController } from './public-logos.controller.js';
import { TenantLogoService } from './tenant-logo.service.js';
import { DnsTxtResolver } from './dns-txt-resolver.js';
import { TenantHostResolver } from './tenant-host-resolver.js';
import { LegalModule } from '../legal/legal.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { MailModule } from '../mail/mail.module.js';
import { TenantClosureService } from './tenant-closure.service.js';

@Module({
  imports: [LegalModule, AuditModule, MailModule],
  controllers: [TenantsController, PublicBrandingController, PublicLogosController],
  providers: [TenantsService, PublicBrandingService, TenantLogoService, TenantClosureService, DnsTxtResolver, TenantHostResolver],
  exports: [TenantsService, TenantHostResolver],
})
export class TenantsModule {}
