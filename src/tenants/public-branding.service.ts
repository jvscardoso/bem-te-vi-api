import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantHostResolver } from './tenant-host-resolver.js';

// Resolve a clínica a partir do host do frontend e devolve só o que é seguro expor
// antes do login (identidade visual). Sem id, status, configurações ou qualquer dado de negócio.
@Injectable()
export class PublicBrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hostResolver: TenantHostResolver,
  ) {}

  async resolve(rawHost: string) {
    // Tenant suspenso responde como inexistente: não há o que tematizar, o login está bloqueado.
    const tenantId = await this.hostResolver.findActiveTenantId(rawHost);
    const tenant = tenantId
      ? await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            name: true,
            branding: {
              select: { tradeName: true, logoUrl: true, primaryColor: true, secondaryColor: true },
            },
          },
        })
      : null;
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
}
