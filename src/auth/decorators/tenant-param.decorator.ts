import { SetMetadata } from '@nestjs/common';

export const TENANT_PARAM_KEY = 'tenantParamKey';

// Nome do route param que carrega o tenantId a validar contra o token (default: 'tenantId').
// Use em controllers onde o param tem outro nome, ex.: TenantsController usa ':id'.
export const TenantParam = (paramName: string) => SetMetadata(TENANT_PARAM_KEY, paramName);
