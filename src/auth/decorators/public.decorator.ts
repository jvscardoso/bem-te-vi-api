import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marca uma rota como isenta de autenticação/autorização
// (JwtAuthGuard, TenantAccessGuard e PermissionsGuard todos respeitam este metadado).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
