import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { TenantsController } from './tenants.controller.js';
import { PublicBrandingController } from './public-branding.controller.js';
import { PublicBrandingService } from './public-branding.service.js';
import { DnsTxtResolver } from './dns-txt-resolver.js';
import { TenantHostResolver } from './tenant-host-resolver.js';

@Module({
  controllers: [TenantsController, PublicBrandingController],
  providers: [TenantsService, PublicBrandingService, DnsTxtResolver, TenantHostResolver],
  exports: [TenantsService, TenantHostResolver],
})
export class TenantsModule {}
