import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { pageOf } from '../common/pagination/page.js';
import type { ListPlatformTenantsQueryDto } from './dto/list-platform-tenants-query.dto.js';
import type { UpdateTenantStatusDto } from './dto/update-tenant-status.dto.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { deletionAvailableAt } from '../tenants/tenant-closure.js';

const TENANT_SUMMARY_SELECT = {
  id: true,
  name: true,
  subdomain: true,
  customDomain: true,
  status: true,
  createdAt: true,
  closureRequestedAt: true,
  _count: { select: { users: true, patients: true } },
} as const;

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // Ordem por nome com desempate por id (a paginação não repete nem pula clínicas).
  // SQL cru só para achar os ids da página: o Prisma não expressa unaccent/ILIKE por palavra.
  // A própria clínica-plataforma nunca aparece (nem por busca — a condição é sempre AND).
  async findAllTenants({ q, page, pageSize }: ListPlatformTenantsQueryDto) {
    const where = this.searchCondition(q);
    const [idRows, countRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM tenants WHERE ${where}
        ORDER BY name ASC, id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM tenants WHERE ${where}`,
    ]);

    const ids = idRows.map((row) => row.id);
    const rows = ids.length
      ? await this.prisma.tenant.findMany({ where: { id: { in: ids } }, select: TENANT_SUMMARY_SELECT })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const total = Number(countRows[0]?.total ?? 0);

    return pageOf(
      ids.flatMap((id) => byId.get(id) ?? []),
      total,
      page,
      pageSize,
    );
  }

  // Ação de plataforma que hoje não existe em nenhum outro lugar: `UpdateTenantDto` (usado
  // pelo próprio admin da clínica) recusa `status` de propósito, para o cliente não conseguir
  // se suspender ou se reativar sozinho.
  async updateTenantStatus(id: string, { status }: UpdateTenantStatusDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id }, select: { isPlatform: true } });
    // A clínica-plataforma também não existe para fins deste endpoint (mesma mensagem de "não
    // encontrado" de um id qualquer, para não revelar que ela existe).
    if (!tenant || tenant.isPlatform) {
      throw new NotFoundException(`Tenant ${id} não encontrado`);
    }
    return this.prisma.tenant.update({
      where: { id },
      data: { status },
      select: { id: true, name: true, status: true },
    });
  }

  // Exclusão definitiva de uma clínica e de todos os seus dados. Só depois de a própria clínica
  // pedir o encerramento e de passada a carência (TENANT_DELETION_GRACE_DAYS) — a plataforma não
  // apaga dados de clínica por conta própria. Sobra só o registro em TenantDeletion.
  async deleteTenant(id: string, actor: AuthenticatedUser, confirmSubdomain: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, subdomain: true, isPlatform: true, closureRequestedAt: true },
    });
    if (!tenant || tenant.isPlatform) {
      throw new NotFoundException(`Tenant ${id} não encontrado`);
    }
    if (confirmSubdomain !== tenant.subdomain) {
      throw new BadRequestException('confirmSubdomain não corresponde ao subdomínio da clínica');
    }
    if (!tenant.closureRequestedAt) {
      throw new ConflictException('A clínica não pediu o encerramento da conta');
    }
    const availableAt = deletionAvailableAt(tenant.closureRequestedAt, this.config);
    if (availableAt > new Date()) {
      throw new ConflictException(
        `A exclusão só é permitida a partir de ${availableAt.toISOString()} (carência do pedido de encerramento)`,
      );
    }

    // Ordem importa: vários FKs são Restrict (anamnese -> usuário/formulário, agendamento ->
    // profissional, cobrança/pagamento -> usuário, usuário -> papel) e barrariam a cascata direta
    // a partir do tenant. O resto (papéis, marca, logo, auditoria, tokens, aceites) vai em cascata.
    await this.prisma.$transaction(async (tx) => {
      const where = { tenantId: id };
      await tx.anamnesisRecord.deleteMany({ where });
      await tx.anamnesisTemplate.deleteMany({ where });
      await tx.charge.deleteMany({ where });
      await tx.appointment.deleteMany({ where });
      await tx.patient.deleteMany({ where });
      await tx.user.deleteMany({ where });
      await tx.tenant.delete({ where: { id } });
      await tx.tenantDeletion.create({
        data: {
          tenantId: id,
          name: tenant.name,
          subdomain: tenant.subdomain,
          closureRequestedAt: tenant.closureRequestedAt!,
          deletedByUserId: actor.userId,
        },
      });
    });
  }

  // Cada palavra da busca precisa casar em nome, subdomínio ou domínio próprio (AND entre
  // palavras, OR entre campos). Tudo parametrizado; os curingas do LIKE digitados pelo
  // usuário são escapados para valerem como texto literal — igual à busca de pacientes.
  private searchCondition(q: string | undefined) {
    const conditions = [Prisma.sql`is_platform = false`];

    for (const token of (q ?? '').split(/\s+/).filter(Boolean)) {
      const pattern = `%${token.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      conditions.push(Prisma.sql`(
        unaccent(name) ILIKE unaccent(${pattern})
        OR subdomain ILIKE ${pattern}
        OR custom_domain ILIKE ${pattern}
      )`);
    }
    return Prisma.join(conditions, ' AND ');
  }
}
