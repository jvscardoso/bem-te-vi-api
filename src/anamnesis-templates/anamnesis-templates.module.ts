import { Module } from '@nestjs/common';
import { AnamnesisTemplatesService } from './anamnesis-templates.service.js';
import { AnamnesisTemplatesController } from './anamnesis-templates.controller.js';

@Module({
  controllers: [AnamnesisTemplatesController],
  providers: [AnamnesisTemplatesService],
  exports: [AnamnesisTemplatesService],
})
export class AnamnesisTemplatesModule {}
