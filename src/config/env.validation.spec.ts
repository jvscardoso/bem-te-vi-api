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

  it('Asaas: sem chave sobe (contratação desligada); com chave, exige URL do mesmo ambiente e token do webhook', () => {
    const prod = { NODE_ENV: 'production', JWT_SECRET: STRONG, ASAAS_WEBHOOK_TOKEN: 'tok' };
    expect(() => validateEnv({ ...prod, ASAAS_API_KEY: '' })).not.toThrow();
    expect(() => validateEnv({ ...prod, ASAAS_API_KEY: '$aact_hmlg_x' })).not.toThrow();
    expect(() => validateEnv({ ...prod, ASAAS_API_KEY: '$aact_prod_x', ASAAS_API_URL: 'https://api.asaas.com/v3' })).not.toThrow();
    expect(() => validateEnv({ ...prod, ASAAS_API_KEY: '$aact_prod_x' })).toThrow(/aponta para o sandbox/);
    expect(() =>
      validateEnv({ ...prod, ASAAS_API_KEY: '$aact_hmlg_x', ASAAS_API_URL: 'https://api.asaas.com/v3' }),
    ).toThrow(/aponta para a produção/);
    expect(() => validateEnv({ ...prod, ASAAS_API_KEY: '$aact_hmlg_x', ASAAS_WEBHOOK_TOKEN: '' })).toThrow(/ASAAS_WEBHOOK_TOKEN/);
  });
});
