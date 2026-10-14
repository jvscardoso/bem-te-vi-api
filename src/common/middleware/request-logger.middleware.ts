import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// Log estruturado de cada requisição (método, rota, status, duração, IP) —
// base para auditoria e detecção de abuso (ex.: muitas tentativas de login/403 seguidas).
// Só o caminho, sem a query string: a busca de pacientes vai em `?q=` (nome, CPF), e dado de
// paciente não pode parar no log. Corpo e headers (senha, tokens, Authorization, cookie) também
// nunca são gravados.
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const { method, ip } = req;
    const path = req.originalUrl.split('?')[0];

    res.on('finish', () => {
      const { statusCode } = res;
      const durationMs = Date.now() - start;
      this.logger.log(`${method} ${path} ${statusCode} ${durationMs}ms - ${ip}`);
    });

    next();
  }
}
