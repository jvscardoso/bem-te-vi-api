import { Transform, Type } from 'class-transformer';
import {
  IsFQDN,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateTenantOwnerDto } from './create-tenant-owner.dto.js';

export class CreateTenantDto {
  @IsString()
  @MaxLength(150)
  name!: string;

  @IsString()
  @MaxLength(63)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'subdomain deve conter apenas letras minúsculas, números e hífen',
  })
  subdomain!: string;

  // Domínio próprio da clínica (whitelabel). Minúsculo e sem espaços, pois a resolução
  // por host (GET /public/branding) compara com igualdade exata.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsFQDN()
  @MaxLength(255)
  customDomain?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  defaultAppointmentDurationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  minAppointmentDurationMinutes?: number;

  // Provisiona junto o primeiro usuário do tenant, com uma role "Admin"
  // que recebe automaticamente todas as permissões do catálogo.
  @IsObject()
  @ValidateNested()
  @Type(() => CreateTenantOwnerDto)
  owner!: CreateTenantOwnerDto;
}
