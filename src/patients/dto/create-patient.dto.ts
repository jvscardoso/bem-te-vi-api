import { IsDateString, IsEmail, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePatientDto {
  @IsString()
  @MaxLength(150)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(14)
  cpf?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  // Formato livre — a forma varia por tenant (ex.: campos de endereço distintos).
  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  notes?: string;
}
