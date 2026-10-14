import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import type { SaveLayoutDto } from './dto/save-layout.dto.js';

// Telas com layout configurável. Lista fixa: o GET sempre traz todas (null = nunca configurada, e
// o front usa o padrão dele), e uma tela fora dela é 404. Tela nova = uma entrada aqui.
export const LAYOUT_SCREENS = ['home'] as const;
type LayoutScreen = (typeof LAYOUT_SCREENS)[number];

const layoutKey = (screen: LayoutScreen) => `layouts.${screen}`;

interface ConfigRow {
  key: string;
  value: Prisma.JsonValue;
  updatedAt: Date;
  updatedByUserId: string;
}

// Configurações de tela da clínica (TenantConfig). Uma configuração por clínica, igual para a
// equipe toda. Sem auditoria: nada aqui é dado de paciente.
@Injectable()
export class ConfigsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    const rows = await this.prisma.tenantConfig.findMany({
      where: { tenantId, key: { in: LAYOUT_SCREENS.map(layoutKey) } },
    });
    const names = await this.userNames(rows.map((row) => row.updatedByUserId));
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const layouts = Object.fromEntries(
      LAYOUT_SCREENS.map((screen) => {
        const row = byKey.get(layoutKey(screen));
        return [screen, row ? this.view(row, names) : null];
      }),
    );
    return { layouts };
  }

  // O corpo inteiro substitui o layout salvo (PUT): a ordem da lista é a ordem dos blocos na tela.
  async saveLayout(tenantId: string, actor: AuthenticatedUser, screen: string, dto: SaveLayoutDto) {
    const key = layoutKey(this.knownScreen(screen));
    // Só os campos conhecidos: o DTO já recusa extras, e isto evita gravar qualquer outra coisa.
    const value = {
      version: dto.version,
      widgets: dto.widgets.map(({ id, type, width }) => ({ id, type, width })),
    };
    const row = await this.prisma.tenantConfig.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value, updatedByUserId: actor.userId },
      update: { value, updatedByUserId: actor.userId },
    });
    return this.view(row, await this.userNames([actor.userId]));
  }

  // Volta ao padrão do front. Idempotente: sem layout salvo, também 204.
  async resetLayout(tenantId: string, screen: string) {
    const key = layoutKey(this.knownScreen(screen));
    await this.prisma.tenantConfig.deleteMany({ where: { tenantId, key } });
  }

  private knownScreen(screen: string): LayoutScreen {
    if (!(LAYOUT_SCREENS as readonly string[]).includes(screen)) {
      throw new NotFoundException('Tela não encontrada');
    }
    return screen as LayoutScreen;
  }

  private view(row: ConfigRow, names: Map<string, string>) {
    const value = row.value as { version: number; widgets: unknown[] };
    return {
      version: value.version,
      widgets: value.widgets,
      updatedAt: row.updatedAt,
      updatedBy: { id: row.updatedByUserId, name: names.get(row.updatedByUserId) ?? null },
    };
  }

  private async userNames(ids: string[]) {
    const unique = [...new Set(ids)];
    const users = unique.length
      ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
      : [];
    return new Map(users.map((user) => [user.id, user.name]));
  }
}
