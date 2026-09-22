import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

// Resolve a clínica a partir do host do frontend e devolve só o que é seguro expor
// antes do login (identidade visual). Sem id, status, configurações ou qualquer dado de negócio.
@Injectable()
export class PublicBrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolve(rawHost: string) {
    const host = this.normalizeHost(rawHost);

    // Tenant suspenso responde como inexistente: não há o que tematizar, o login está bloqueado.
    const tenant = await this.prisma.tenant.findFirst({
      where: { status: 'active', OR: this.candidates(host) },
      select: {
        name: true,
        branding: {
          select: { tradeName: true, logoUrl: true, primaryColor: true, secondaryColor: true },
        },
      },
    });
    if (!tenant) {
      throw new NotFoundException('Clínica não encontrada para este endereço');
    }

    return {
      name: tenant.name,
      tradeName: tenant.branding?.tradeName ?? null,
      logoUrl: tenant.branding?.logoUrl ?? null,
      primaryColor: tenant.branding?.primaryColor ?? null,
      secondaryColor: tenant.branding?.secondaryColor ?? null,
    };
  }

  // Domínio próprio casa por igualdade exata. O subdomínio vem de "<sub>.<APP_BASE_DOMAIN>";
  // sem APP_BASE_DOMAIN configurado (ou com um host sem ponto, como em dev), o próprio host
  // é tratado como subdomínio.
  private candidates(host: string): Prisma.TenantWhereInput[] {
    const candidates: Prisma.TenantWhereInput[] = [{ customDomain: host }];

    const baseDomain = this.config.get<string>('APP_BASE_DOMAIN')?.trim().toLowerCase();
    if (baseDomain && host.endsWith(`.${baseDomain}`)) {
      const subdomain = host.slice(0, -(baseDomain.length + 1));
      if (subdomain && !subdomain.includes('.')) {
        candidates.push({ subdomain });
      }
    } else if (!host.includes('.')) {
      candidates.push({ subdomain: host });
    }
    return candidates;
  }

  private normalizeHost(rawHost: string): string {
    return rawHost
      .trim()
      .toLowerCase()
      .replace(/:\d+$/, '')
      .replace(/\.$/, '');
  }
}
