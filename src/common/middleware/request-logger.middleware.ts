import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// Log estruturado de cada requisição (método, rota, status, duração, IP) —
// base para auditoria e detecção de abuso (ex.: muitas tentativas de login/403 seguidas).
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const { method, originalUrl, ip } = req;

    res.on('finish', () => {
      const { statusCode } = res;
      const durationMs = Date.now() - start;
      this.logger.log(`${method} ${originalUrl} ${statusCode} ${durationMs}ms - ${ip}`);
    });

    next();
  }
}
