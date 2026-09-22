import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateChargeDto {
  @IsUUID('4')
  patientId!: string;

  // Precisa ser um agendamento do mesmo paciente (checado no serviço).
  @IsOptional()
  @IsUUID('4')
  appointmentId?: string;

  @IsString()
  @MaxLength(200)
  description!: string;

  // Em centavos (R$ 150,00 = 15000). O teto é só defesa contra erro de digitação/overflow,
  // não um limite de negócio real.
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents!: number;

  @IsDateString()
  dueDate!: string;
}
