import { validateEnv } from './env.validation.js';

const STRONG = 'x'.repeat(32);

describe('validateEnv', () => {
  it('fora de produção aceita qualquer coisa (dev e testes usam os valores de exemplo)', () => {
    expect(() => validateEnv({ NODE_ENV: 'development', JWT_SECRET: 'change-me' })).not.toThrow();
    expect(() => validateEnv({ JWT_SECRET: '' })).not.toThrow();
  });

  it('em produção recusa os segredos de exemplo, mesmo com outra caixa ou espaços', () => {
    for (const secret of ['change-me', 'CHANGE-ME', ' ci-test-secret ']) {
      expect(() => validateEnv({ NODE_ENV: 'production', JWT_SECRET: secret })).toThrow(/valor de exemplo/);
    }
  });

  it('em produção recusa segredo curto ou ausente', () => {
    expect(() => validateEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(31) })).toThrow(/32 caracteres/);
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/32 caracteres/);
  });

  it('em produção aceita um segredo forte', () => {
    expect(() => validateEnv({ NODE_ENV: 'production', JWT_SECRET: STRONG })).not.toThrow();
  });
});
