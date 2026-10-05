import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Atrás de proxy/balanceador (o normal em produção), sem isto `req.ip` é o IP do proxy: o rate
  // limit trataria todo mundo como um único cliente e a auditoria gravaria o IP errado.
  // TRUST_PROXY = número de proxies na frente da API (ex.: 1). Só ligue se houver proxy: sem
  // proxy, confiar no X-Forwarded-For deixaria qualquer cliente forjar o próprio IP.
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }
  // Faz o SIGTERM do `docker stop` fechar o Nest (e o pool do Prisma) em vez de matar o processo.
  app.enableShutdownHooks();
  app.use(helmet());
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
