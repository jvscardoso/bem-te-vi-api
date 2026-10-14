// Valores de exemplo (do .env.example, do CI e da documentação). Em produção, qualquer um deles
// deixaria todos os tokens forjáveis por quem leu o repositório.
const EXAMPLE_JWT_SECRETS = new Set(['change-me', 'changeme', 'secret', 'ci-test-secret']);
const MIN_JWT_SECRET_LENGTH = 32;

// Roda na inicialização (main.ts). Fora de produção não exige nada: dev e testes usam os valores
// de exemplo de propósito. Em produção, a API não sobe com um segredo fraco — melhor falhar no
// deploy, com o motivo no log, do que rodar inseguro.
// Não é o `validate` do ConfigModule de propósito: ele congelaria as variáveis no carregamento,
// e o código (e os testes) leem o process.env na hora do uso.
export function validateEnv(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }
  const problems: string[] = [];

  const jwtSecret = env.JWT_SECRET ?? '';
  if (EXAMPLE_JWT_SECRETS.has(jwtSecret.trim().toLowerCase())) {
    problems.push('JWT_SECRET está com um valor de exemplo');
  } else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET precisa ter pelo menos ${MIN_JWT_SECRET_LENGTH} caracteres`);
  }

  if (problems.length > 0) {
    throw new Error(
      `Configuração insegura para produção (NODE_ENV=production): ${problems.join('; ')}. ` +
        'Gere um segredo com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
}
