import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { detectLogoMimeType } from './logo-image.js';

@Injectable()
export class TenantLogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // Substitui o logo (um por clínica) e aponta `branding.logoUrl` para a rota pública que o
  // serve. A URL é absoluta porque o frontend a usa direto em <img src>, e ela é gravada no
  // upload: se API_PUBLIC_URL mudar, logos já enviados precisam ser reenviados.
  async upload(tenantId: string, file: { buffer: Buffer } | undefined) {
    if (!file || file.buffer.length === 0) {
      throw new BadRequestException('Envie a imagem no campo "file" (multipart/form-data)');
    }
    const mimeType = detectLogoMimeType(file.buffer);
    if (!mimeType) {
      throw new BadRequestException('O logo deve ser uma imagem PNG, JPEG ou WebP');
    }
    await this.assertTenantExists(tenantId);

    return this.prisma.$transaction(async (tx) => {
      await tx.tenantLogo.deleteMany({ where: { tenantId } });
      const logo = await tx.tenantLogo.create({
        data: { tenantId, mimeType, data: new Uint8Array(file.buffer) },
        select: { id: true },
      });
      const logoUrl = `${this.publicApiUrl()}/public/logos/${logo.id}`;
      return tx.tenantBranding.upsert({
        where: { tenantId },
        create: { tenantId, logoUrl },
        update: { logoUrl },
      });
    });
  }

  // Remove o logo, enviado ou por URL externa: a clínica volta ao logo padrão.
  async remove(tenantId: string) {
    await this.assertTenantExists(tenantId);
    return this.prisma.$transaction(async (tx) => {
      await tx.tenantLogo.deleteMany({ where: { tenantId } });
      return tx.tenantBranding.upsert({
        where: { tenantId },
        create: { tenantId, logoUrl: null },
        update: { logoUrl: null },
      });
    });
  }

  // Público (vai em <img src> da tela de login, antes de existir token). O id é aleatório e
  // muda a cada upload, então não serve para listar clínicas nem expõe o tenantId.
  async find(id: string) {
    const logo = await this.prisma.tenantLogo.findUnique({
      where: { id },
      select: { mimeType: true, data: true },
    });
    if (!logo) {
      throw new NotFoundException('Logo não encontrado');
    }
    return logo;
  }

  private publicApiUrl() {
    const configured = this.config.get<string>('API_PUBLIC_URL')?.trim();
    return (configured || `http://localhost:${this.config.get<string>('PORT') ?? 3000}`).replace(/\/+$/, '');
  }

  private async assertTenantExists(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} não encontrado`);
    }
  }
}
