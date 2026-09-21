import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { TenantStatus } from '@prisma/client';
import { CreateTenantDto } from './create-tenant.dto.js';

// `owner` só existe no signup; repassá-lo ao Prisma no update quebraria a query.
export class UpdateTenantDto extends PartialType(OmitType(CreateTenantDto, ['owner'] as const)) {
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;
}
