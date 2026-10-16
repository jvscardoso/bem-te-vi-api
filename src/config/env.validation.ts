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
  const jwtProblem = problems.length > 0;
  problems.push(...asaasProblems(env));

  if (problems.length > 0) {
    throw new Error(
      `Configuração insegura para produção (NODE_ENV=production): ${problems.join('; ')}.` +
        (jwtProblem
          ? ' Gere um segredo com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
          : ''),
    );
  }
}

// Asaas (mensalidades). Sem chave, só a contratação fica desligada (503) e a API sobe. Com chave:
// a de sandbox ($aact_hmlg_) só funciona na URL de sandbox, e a de produção ($aact_prod_) só na de
// produção; misturar dá erro em toda contratação, então é melhor falhar no deploy. E sem o token do
// webhook nenhum pagamento seria aceito: a clínica pagaria e continuaria bloqueada.
function asaasProblems(env: Record<string, string | undefined>): string[] {
  const key = env.ASAAS_API_KEY?.trim();
  if (!key) {
    return [];
  }
  const problems: string[] = [];
  const sandboxUrl = (env.ASAAS_API_URL?.trim() || 'https://api-sandbox.asaas.com/v3').includes('sandbox');
  if (key.startsWith('$aact_prod_') && sandboxUrl) {
    problems.push('ASAAS_API_KEY é de produção, mas ASAAS_API_URL aponta para o sandbox');
  }
  if (key.startsWith('$aact_hmlg_') && !sandboxUrl) {
    problems.push('ASAAS_API_KEY é de sandbox, mas ASAAS_API_URL aponta para a produção');
  }
  if (!env.ASAAS_WEBHOOK_TOKEN?.trim()) {
    problems.push('ASAAS_WEBHOOK_TOKEN é obrigatório quando ASAAS_API_KEY está configurada');
  }
  return problems;
}
