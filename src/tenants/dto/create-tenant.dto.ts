import { Type } from 'class-transformer';
import {
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

  @IsOptional()
  @IsString()
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
