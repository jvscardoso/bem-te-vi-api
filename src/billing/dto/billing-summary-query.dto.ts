import { IsDateString, IsOptional } from 'class-validator';

// Janela usada só para "pago no período" (por data do pagamento); pendente/atrasado/cancelado
// são sempre o total atual, independente do período (não faz sentido "pendente em janeiro").
export class BillingSummaryQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
