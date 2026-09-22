import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';

// 'overdue' não é um status armazenado (é `pending` com dueDate no passado) — o serviço
// traduz isto num filtro composto antes de consultar o banco. Os dois se excluem: uma
// cobrança pendente aparece em exatamente um dos dois, nunca nos dois ao mesmo tempo.
export const CHARGE_STATUS_FILTERS = ['pending', 'overdue', 'paid', 'cancelled'] as const;
export type ChargeStatusFilter = (typeof CHARGE_STATUS_FILTERS)[number];

export class ListChargesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  patientId?: string;

  @IsOptional()
  @IsEnum(CHARGE_STATUS_FILTERS)
  status?: ChargeStatusFilter;

  // Janela por vencimento (dueDate), limites inclusivos.
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
