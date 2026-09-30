export interface JwtPayload {
  sub: string;
  tenantId: string;
  roleId: string;
  permissions: string[];
  // User.passwordVersion no momento do login. Opcional porque tokens emitidos antes deste
  // campo existir não o têm; valem como versão 0.
  pwv?: number;
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  roleId: string;
  permissions: string[];
}
