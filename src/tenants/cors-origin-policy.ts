import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

// Quanto tempo a resposta sobre um domínio próprio fica guardada em memória. O CORS é checado
// em toda requisição de navegador; sem isso, cada uma custaria uma consulta a mais. Um domínio
// recém-verificado passa a valer em até um minuto.
const CUSTOM_DOMAIN_CACHE_MS = 60_000;
// Origens desconhecidas também entram no cache; o teto impede que alguém o encha mandando
// Origins inventadas.
const CUSTOM_DOMAIN_CACHE_MAX = 1_000;

// Quais origens (sites) podem chamar a API pelo navegador. O token vai no header
// Authorization, mas o refresh token vai em cookie (ver SessionsService): uma origem liberada
// aqui consegue ler a resposta de /auth/refresh, então a lista é fechada:
// - o domínio base da plataforma e os subdomínios dele (clínicas, backoffice, landing);
// - domínios próprios de clínica já verificados por DNS (mesma regra do TenantHostResolver);
// - CORS_EXTRA_ORIGINS: origens exatas fora disso (ex.: a landing num domínio separado);
// - fora de produção: localhost e *.localhost, em qualquer porta (o Vite do front).
// Uma origem fora da lista não recebe Access-Control-Allow-Origin: o navegador bloqueia a
// leitura da resposta. Clientes sem Origin (curl, Postman, servidores) não são afetados.
@Injectable()
export class CorsOriginPolicy {
  private readonly customDomainCache = new Map<string, { allowed: boolean; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async isAllowed(origin: string | undefined): Promise<boolean> {
    if (!origin) {
      return false;
    }
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    const extraOrigins = (this.config.get<string>('CORS_EXTRA_ORIGINS') ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase().replace(/\/$/, ''));
    if (extraOrigins.includes(url.origin)) {
      return true;
    }
    const production = this.config.get<string>('NODE_ENV') === 'production';
    const host = url.hostname;
    if (!production && url.protocol === 'http:' && (host === 'localhost' || host.endsWith('.localhost'))) {
      return true;
    }
    // Em produção, só https: uma página http pode ter sido alterada no caminho.
    if (url.protocol !== 'https:' && (production || url.protocol !== 'http:')) {
      return false;
    }
    const baseDomain = this.config.get<string>('APP_BASE_DOMAIN')?.trim().toLowerCase();
    if (baseDomain && (host === baseDomain || host.endsWith(`.${baseDomain}`))) {
      return true;
    }
    return this.isVerifiedCustomDomain(host);
  }

  private async isVerifiedCustomDomain(host: string): Promise<boolean> {
    const cached = this.customDomainCache.get(host);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.allowed;
    }
    const tenant = await this.prisma.tenant.findFirst({
      where: { customDomain: host, customDomainVerifiedAt: { not: null } },
      select: { id: true },
    });
    if (this.customDomainCache.size >= CUSTOM_DOMAIN_CACHE_MAX) {
      this.customDomainCache.clear();
    }
    this.customDomainCache.set(host, { allowed: tenant !== null, expiresAt: Date.now() + CUSTOM_DOMAIN_CACHE_MS });
    return tenant !== null;
  }
}
