import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      // `pg` não manda TCP keepalive por padrão. Sem isso, um NAT/proxy no meio do caminho
      // (ex.: a rede do Docker Desktop no Windows) pode derrubar uma conexão ociosa ou sob
      // volume em silêncio, e a próxima query nela quebra com ECONNRESET.
      keepAlive: true,
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
