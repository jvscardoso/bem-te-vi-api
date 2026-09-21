export interface JwtPayload {
  sub: string;
  tenantId: string;
  roleId: string;
  permissions: string[];
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  roleId: string;
  permissions: string[];
}
