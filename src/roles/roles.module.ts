import { Module } from '@nestjs/common';
import { AccessPolicyModule } from '../access/access-policy.module.js';
import { RolesService } from './roles.service.js';
import { RolesController } from './roles.controller.js';
import { PermissionsController } from './permissions.controller.js';

@Module({
  imports: [AccessPolicyModule],
  controllers: [RolesController, PermissionsController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
