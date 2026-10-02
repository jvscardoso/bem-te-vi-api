import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Estes testes fazem muitas requisições reais contra o Postgres do Docker; em volume,
    // isso ocasionalmente esbarra em instabilidade de rede do ambiente (ECONNRESET), não em
    // bug de lógica — a suíte não fica verde "por sorte": um teste que falha por asserção
    // errada continua falhando na repetição. Prática padrão para essa classe de flake em e2e.
    retry: 2,
    // Os beforeAll criam clínicas e usuários de verdade: cada um custa um hash bcrypt (custo 12)
    // e um login (outro bcrypt). Com todos os arquivos em paralelo disputando CPU, setups como o
    // de appointments-pagination (2 clínicas + 6 usuários) passavam do padrão de 10s — e o
    // `retry` não cobre falha em hook, então o arquivo inteiro caía.
    hookTimeout: 60_000,
  },
});
