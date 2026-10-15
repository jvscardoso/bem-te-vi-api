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
import { LegalAcceptanceDto } from '../../legal/dto/legal-acceptance.dto.js';
import { RequiredText } from '../../common/validation/required-text.decorator.js';
import { IsIanaTimeZone } from '../../common/validation/time-zone.js';

export class CreateTenantDto {
  @RequiredText(150)
  name!: string;

  // Rótulo DNS válido: letras minúsculas, números e hífen, sem hífen no começo nem no fim
  // ("-clinica-" não resolveria como host). Os reservados (www, api...) são checados no serviço.
  @IsString()
  @MaxLength(63)
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, {
    message: 'O subdomínio deve ter só letras minúsculas, números e hífen, sem hífen no começo nem no fim',
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

  // Fuso IANA da clínica (padrão America/Sao_Paulo). Gravado no nome canônico.
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;

  // Provisiona junto o primeiro usuário do tenant, com uma role "Admin"
  // que recebe automaticamente todas as permissões do catálogo.
  @IsObject()
  @ValidateNested()
  @Type(() => CreateTenantOwnerDto)
  owner!: CreateTenantOwnerDto;

  // O dono aceita os Termos de Uso e a Política de Privacidade vigentes (GET /public/legal) em
  // nome da clínica. Obrigatório: sem aceite registrado não há cadastro.
  @IsObject()
  @ValidateNested()
  @Type(() => LegalAcceptanceDto)
  legalAcceptance!: LegalAcceptanceDto;
}
