import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class FindAppointmentsQueryDto {
  @IsOptional()
  @IsUUID('4')
  professionalId?: string;

  @IsOptional()
  @IsUUID('4')
  patientId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
