import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateTenantDto } from './create-tenant.dto.js';

// `owner` só existe no signup; repassá-lo ao Prisma no update quebraria a query.
// `status` (suspender/reativar) é ação da plataforma, não do cliente: fica de fora
// para que o admin da clínica não consiga suspender (ou reativar) o próprio tenant.
export class UpdateTenantDto extends PartialType(OmitType(CreateTenantDto, ['owner'] as const)) {}
