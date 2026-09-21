import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID('4')
  patientId!: string;

  @IsUUID('4')
  professionalId!: string;

  @IsDateString()
  scheduledAt!: string;

  // Se omitido, o fim é calculado com a duração padrão do profissional
  // (ou, na falta dela, da clínica).
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
