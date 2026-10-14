import { Module } from '@nestjs/common';
import { ConfigsController } from './configs.controller.js';
import { ConfigsService } from './configs.service.js';

// Configurações de tela da clínica (/tenants/:tenantId/configs). Não confundir com o ConfigModule
// do Nest (variáveis de ambiente).
@Module({
  controllers: [ConfigsController],
  providers: [ConfigsService],
})
export class ConfigsModule {}
