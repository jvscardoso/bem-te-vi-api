import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { CorsOriginPolicy } from './tenants/cors-origin-policy.js';

// O que o main.ts aplica sobre o app além dos módulos. Os testes e2e chamam a mesma função,
// para testar a API como ela sobe de verdade (CORS, helmet). A validação não está aqui: é o
// APP_PIPE do AppModule.
export function configureApp(app: NestExpressApplication) {
  // Atrás de proxy/balanceador (o normal em produção), sem isto `req.ip` é o IP do proxy: o rate
  // limit trataria todo mundo como um único cliente e a auditoria gravaria o IP errado.
  // TRUST_PROXY = número de proxies na frente da API (ex.: 1). Só ligue se houver proxy: sem
  // proxy, confiar no X-Forwarded-For deixaria qualquer cliente forjar o próprio IP.
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }
  app.use(helmet());

  // `credentials: true` porque o refresh token vai em cookie. Com isso, o navegador só aceita a
  // resposta se a origem vier ecoada exatamente (nunca "*"), o que a política abaixo garante.
  const corsPolicy = app.get(CorsOriginPolicy);
  app.enableCors({
    origin: (origin, callback) => {
      corsPolicy.isAllowed(origin).then(
        (allowed) => callback(null, allowed),
        (error: Error) => callback(error),
      );
    },
    credentials: true,
    maxAge: 600,
  });
}
