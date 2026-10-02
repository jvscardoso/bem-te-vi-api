import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

// Descobre a clínica dona de um host do frontend (ex.: "clinica-a.bemtevi.com.br" ou o
// domínio próprio "agenda.clinica.com.br"). Única fonte dessa regra: a marca exibida
// (GET /public/branding) e a clínica exigida no login (POST /auth/login) precisam concordar,
// senão a tela mostraria a marca de uma clínica e aceitaria usuários de outra.
@Injectable()
export class TenantHostResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // Id da clínica ativa do host, ou null (host da própria plataforma, desconhecido, clínica
  // suspensa ou domínio próprio ainda não verificado).
  async findActiveTenantId(rawHost: string): Promise<string | null> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { status: 'active', OR: this.candidates(this.normalize(rawHost)) },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }

  // Domínio próprio casa por igualdade exata. O subdomínio vem de "<sub>.<APP_BASE_DOMAIN>";
  // sem APP_BASE_DOMAIN configurado (ou com um host sem ponto, como em dev), o próprio host
  // é tratado como subdomínio.
  private candidates(host: string): Prisma.TenantWhereInput[] {
    // Domínio próprio só resolve depois de comprovado por DNS (ver TenantsService.verifyDomain).
    // Sem isso, quem reivindica o domínio de outra empresa no signup controlaria a marca
    // exibida nesse host antes mesmo de provar que é dono dele.
    const candidates: Prisma.TenantWhereInput[] = [
      { customDomain: host, customDomainVerifiedAt: { not: null } },
    ];

    const baseDomain = this.config.get<string>('APP_BASE_DOMAIN')?.trim().toLowerCase();
    if (baseDomain && host.endsWith(`.${baseDomain}`)) {
      const subdomain = host.slice(0, -(baseDomain.length + 1));
      if (subdomain && !subdomain.includes('.')) {
        candidates.push({ subdomain });
      }
    } else if (host && !host.includes('.')) {
      candidates.push({ subdomain: host });
    }
    return candidates;
  }

  // Porta, maiúsculas e ponto final não mudam o host.
  private normalize(rawHost: string): string {
    return rawHost
      .trim()
      .toLowerCase()
      .replace(/:\d+$/, '')
      .replace(/\.$/, '');
  }
}
