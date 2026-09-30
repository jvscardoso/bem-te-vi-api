// Campos de User que nunca saem numa resposta: o hash da senha e a versão dela (que só
// serve para invalidar tokens, ver JwtStrategy). Use em todo `omit` de consulta de usuário.
export const USER_SECRET_FIELDS = { passwordHash: true, passwordVersion: true } as const;
