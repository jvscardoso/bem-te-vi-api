import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app-setup.js';
import { validateEnv } from './config/env.validation.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Depois do create: o ConfigModule já carregou o .env no process.env. Em produção, segredo
  // fraco ou de exemplo derruba a subida aqui, com o motivo no log, antes de abrir a porta.
  validateEnv(process.env);
  configureApp(app);
  // Faz o SIGTERM do `docker stop` fechar o Nest (e o pool do Prisma) em vez de matar o processo.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
