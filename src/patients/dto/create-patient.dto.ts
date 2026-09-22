import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreatePatientDto {
  @IsString()
  @MaxLength(150)
  fullName!: string;

  // Guardado só com dígitos ("111.111.111-11" e "11111111111" são o mesmo CPF): a unique por
  // tenant e a busca por CPF dependem disso. Aceita com ou sem pontuação; null limpa.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @Matches(/^\d{11}$/, { message: 'cpf deve ter 11 dígitos' })
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
