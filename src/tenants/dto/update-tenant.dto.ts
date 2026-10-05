import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateTenantDto } from './create-tenant.dto.js';

// `owner` e `legalAcceptance` só existem no signup; repassá-los ao Prisma no update quebraria a query.
// `status` (suspender/reativar) é ação da plataforma, não do cliente: fica de fora
// para que o admin da clínica não consiga suspender (ou reativar) o próprio tenant.
export class UpdateTenantDto extends PartialType(OmitType(CreateTenantDto, ['owner', 'legalAcceptance'] as const)) {}
