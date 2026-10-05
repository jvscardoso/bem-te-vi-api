import { Module } from '@nestjs/common';
import { LegalService } from './legal.service.js';
import { PublicLegalController } from './public-legal.controller.js';

@Module({
  controllers: [PublicLegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
