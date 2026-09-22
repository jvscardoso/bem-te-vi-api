import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { ChargeStatus } from '@prisma/client';
import { CreateChargeDto } from './create-charge.dto.js';

export class UpdateChargeDto extends PartialType(CreateChargeDto) {
  // Só `cancelled` é aceito aqui: `paid` nunca se define por PATCH, só como consequência de
  // pagamento suficiente registrado (ver BillingService.recordPayment) — senão dava para
  // "marcar como pago" sem nenhum dinheiro ter sido de fato recebido.
  @IsOptional()
  @IsEnum(ChargeStatus)
  status?: ChargeStatus;
}
