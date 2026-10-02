import { Module } from '@nestjs/common';
import { AccessPolicyModule } from '../access/access-policy.module.js';
import { AccountModule } from '../account/account.module.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { ProfessionalsController } from './professionals.controller.js';

@Module({
  imports: [AccessPolicyModule, AccountModule],
  controllers: [UsersController, ProfessionalsController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
