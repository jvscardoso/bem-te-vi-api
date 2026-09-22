import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { pageOf } from '../common/pagination/page.js';
import type { ListPlatformTenantsQueryDto } from './dto/list-platform-tenants-query.dto.js';
import type { UpdateTenantStatusDto } from './dto/update-tenant-status.dto.js';

const TENANT_SUMMARY_SELECT = {
  id: true,
  name: true,
  subdomain: true,
  customDomain: true,
  status: true,
  createdAt: true,
  _count: { select: { users: true, patients: true } },
} as const;

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

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
