export interface JwtPayload {
  sub: string;
  tenantId: string;
  roleId: string;
  permissions: string[];
  // User.passwordVersion no momento do login. Opcional porque tokens emitidos antes deste
  // campo existir não o têm; valem como versão 0.
  pwv?: number;
  // Sessão de login (Session.id). Token sem sessão (de antes do refresh token) é recusado.
  sid?: string;
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  roleId: string;
  permissions: string[];
  // Sessão do token em uso: a troca de senha derruba as outras e mantém esta.
  sessionId: string;
}
