import type { ConfigService } from '@nestjs/config';

// Carência entre o pedido de encerramento e a exclusão definitiva: tempo para a clínica
// exportar os dados ou desistir (pedido feito por engano, por quem não devia). Configurável por
// TENANT_DELETION_GRACE_DAYS; padrão de 30 dias.
export function deletionGraceDays(config: ConfigService): number {
  const configured = Number(config.get<string>('TENANT_DELETION_GRACE_DAYS'));
  return Number.isInteger(configured) && configured >= 0 ? configured : 30;
}

export function deletionAvailableAt(requestedAt: Date, config: ConfigService): Date {
  return new Date(requestedAt.getTime() + deletionGraceDays(config) * 24 * 60 * 60 * 1000);
}
