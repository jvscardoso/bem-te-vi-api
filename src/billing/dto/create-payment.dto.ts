import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreatePaymentDto {
  // Não pode exceder o saldo devedor da cobrança — checado no serviço, não aqui (depende do
  // que já foi pago antes).
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  // Default: agora. Existe para registrar um pagamento recebido antes (ex.: conciliação).
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
