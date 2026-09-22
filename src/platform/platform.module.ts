import { Module } from '@nestjs/common';
import { PlatformService } from './platform.service.js';
import { PlatformController } from './platform.controller.js';

@Module({
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
