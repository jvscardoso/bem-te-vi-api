import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { DnsTxtResolver } from './dns-txt-resolver.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { UpdateTenantBrandingDto } from './dto/update-tenant-branding.dto.js';

const SALT_ROUNDS = 12;
const OWNER_ROLE_NAME = 'Admin';

// Subdomínio dedicado ao desafio de verificação (não mexe no apex do domínio do cliente,
// que pode já ter SPF/DKIM etc.). Convenção igual à de Vercel (`_vercel`) e afins.
const CHALLENGE_SUBDOMAIN = '_bemtevi-challenge';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dnsTxtResolver: DnsTxtResolver,
  ) {}

  async create({ owner, ...tenantData }: CreateTenantDto) {
    const email = owner.email.toLowerCase();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException(`Já existe um usuário com o email ${email}`);
    }

    const passwordHash = await hash(owner.password, SALT_ROUNDS);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          ...tenantData,
          ...this.customDomainChallengeFields(null, tenantData.customDomain),
        },
        omit: { customDomainVerificationToken: true },
      });
      // Confere com os valores efetivos (inclui os defaults do schema); lançar aqui desfaz a transação.
      this.assertDurationSettings(
        tenant.defaultAppointmentDurationMinutes,
        tenant.minAppointmentDurationMinutes,
      );

      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          name: OWNER_ROLE_NAME,
          description: 'Acesso total ao tenant, criada automaticamente no cadastro',
        },
      });

      const permissions = await tx.permission.findMany({ select: { id: true } });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map(({ id }) => ({ roleId: role.id, permissionId: id })),
        });
      }

      const ownerUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          roleId: role.id,
          name: owner.name,
          email,
          passwordHash,
        },
        omit: { passwordHash: true },
      });

      return { tenant, role: { id: role.id, name: role.name }, owner: ownerUser };
    });
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: { branding: true },
      omit: { customDomainVerificationToken: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} não encontrado`);
    }
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    const tenant = await this.findOne(id);
    this.assertDurationSettings(
      dto.defaultAppointmentDurationMinutes ?? tenant.defaultAppointmentDurationMinutes,
      dto.minAppointmentDurationMinutes ?? tenant.minAppointmentDurationMinutes,
    );

    if (dto.minAppointmentDurationMinutes !== undefined) {
      const belowMin = await this.prisma.user.count({
        where: {
          tenantId: id,
          defaultAppointmentDurationMinutes: { lt: dto.minAppointmentDurationMinutes },
        },
      });
      if (belowMin > 0) {
        throw new BadRequestException(
          `${belowMin} profissional(is) têm duração padrão menor que o novo mínimo de ${dto.minAppointmentDurationMinutes} minutos`,
        );
      }
    }

    return this.prisma.tenant.update({
      where: { id },
      data: { ...dto, ...this.customDomainChallengeFields(tenant.customDomain, dto.customDomain) },
      omit: { customDomainVerificationToken: true },
    });
  }

  async updateBranding(id: string, dto: UpdateTenantBrandingDto) {
    await this.findOne(id);
    return this.prisma.tenantBranding.upsert({
      where: { tenantId: id },
      create: { tenantId: id, ...dto },
      update: dto,
    });
  }

  // Instruções para o cliente configurar o DNS: nome/valor do TXT e se já foi confirmado.
  async getDomainVerification(id: string) {
    const tenant = await this.findTenantWithChallenge(id);
    return this.domainVerificationView(tenant);
  }

  // Consulta o DNS agora e, se o TXT esperado estiver lá, marca o domínio como verificado.
  // Idempotente e seguro de chamar repetidamente (é assim que o cliente confirma: tenta,
  // vê que ainda não propagou, tenta de novo mais tarde).
  async verifyDomain(id: string) {
    const tenant = await this.findTenantWithChallenge(id);
    if (tenant.customDomainVerifiedAt) {
      return this.domainVerificationView(tenant);
    }

    const records = await this.dnsTxtResolver.resolveTxt(
      `${CHALLENGE_SUBDOMAIN}.${tenant.customDomain}`,
    );
    if (!records.includes(tenant.customDomainVerificationToken!)) {
      return this.domainVerificationView(tenant);
    }

    const verifiedAt = new Date();
    await this.prisma.tenant.update({ where: { id }, data: { customDomainVerifiedAt: verifiedAt } });
    return this.domainVerificationView({ ...tenant, customDomainVerifiedAt: verifiedAt });
  }

  private async findTenantWithChallenge(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { customDomain: true, customDomainVerificationToken: true, customDomainVerifiedAt: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} não encontrado`);
    }
    if (!tenant.customDomain) {
      throw new NotFoundException('Este tenant não tem domínio próprio configurado');
    }
    return tenant as {
      customDomain: string;
      customDomainVerificationToken: string;
      customDomainVerifiedAt: Date | null;
    };
  }

  private domainVerificationView(tenant: {
    customDomain: string;
    customDomainVerificationToken: string;
    customDomainVerifiedAt: Date | null;
  }) {
    return {
      domain: tenant.customDomain,
      verified: tenant.customDomainVerifiedAt !== null,
      verifiedAt: tenant.customDomainVerifiedAt,
      record: {
        type: 'TXT',
        name: `${CHALLENGE_SUBDOMAIN}.${tenant.customDomain}`,
        value: tenant.customDomainVerificationToken,
      },
    };
  }

  // Gera um novo desafio sempre que o domínio muda de valor; limpa tudo quando é removido;
  // não toca em nada quando o campo nem foi enviado ou foi reenviado com o mesmo valor —
  // reconfirmar o mesmo domínio não deveria derrubar uma verificação já feita.
  private customDomainChallengeFields(previousDomain: string | null, nextDomain?: string | null) {
    if (nextDomain === undefined || nextDomain === previousDomain) {
      return undefined;
    }
    return {
      customDomainVerificationToken: nextDomain ? randomBytes(24).toString('hex') : null,
      customDomainVerifiedAt: null,
    };
  }

  private assertDurationSettings(defaultMinutes: number, minMinutes: number) {
    if (defaultMinutes < minMinutes) {
      throw new BadRequestException(
        'A duração padrão do atendimento não pode ser menor que a duração mínima',
      );
    }
  }
}
