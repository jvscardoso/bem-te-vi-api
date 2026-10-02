import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { TenantsController } from './tenants.controller.js';
import { PublicBrandingController } from './public-branding.controller.js';
import { PublicBrandingService } from './public-branding.service.js';
import { PublicLogosController } from './public-logos.controller.js';
import { TenantLogoService } from './tenant-logo.service.js';
import { DnsTxtResolver } from './dns-txt-resolver.js';
import { TenantHostResolver } from './tenant-host-resolver.js';

@Module({
  controllers: [TenantsController, PublicBrandingController, PublicLogosController],
  providers: [TenantsService, PublicBrandingService, TenantLogoService, DnsTxtResolver, TenantHostResolver],
  exports: [TenantsService, TenantHostResolver],
})
export class TenantsModule {}
