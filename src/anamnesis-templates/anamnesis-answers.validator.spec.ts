import {
  validateAnswers,
  validateTemplateFields,
  type AnamnesisFieldDefinition,
} from './anamnesis-answers.validator.js';

const field = (overrides: Partial<AnamnesisFieldDefinition>): AnamnesisFieldDefinition => ({
  key: 'campo',
  label: 'Campo',
  type: 'text',
  required: false,
  ...overrides,
});

describe('validateTemplateFields', () => {
  it('aceita select/multiselect com opções e os demais tipos sem opções', () => {
    expect(
      validateTemplateFields([
        field({ key: 'a', type: 'select', options: ['x', 'y'] }),
        field({ key: 'b', type: 'multiselect', options: ['x'] }),
        field({ key: 'c', type: 'text' }),
      ]),
    ).toEqual([]);
  });

  it('rejeita select/multiselect sem opções (ou com lista vazia)', () => {
    expect(validateTemplateFields([field({ key: 'a', type: 'select' })])).toEqual([
      expect.stringContaining('"a"'),
    ]);
    expect(validateTemplateFields([field({ key: 'b', type: 'multiselect', options: [] })])).toEqual([
      expect.stringContaining('"b"'),
    ]);
  });

  it('rejeita opções em campo que não é select/multiselect', () => {
    expect(validateTemplateFields([field({ key: 'a', type: 'text', options: ['x'] })])).toEqual([
      expect.stringContaining('"a"'),
    ]);
  });

  it('acumula um erro por campo problemático, não só o primeiro', () => {
    expect(
      validateTemplateFields([field({ key: 'a', type: 'select' }), field({ key: 'b', type: 'select' })]),
    ).toHaveLength(2);
  });
});

describe('validateAnswers', () => {
  it('aceita respostas completas e corretas, sem erros', () => {
    const fields = [
      field({ key: 'queixa', type: 'textarea', required: true }),
      field({ key: 'idade', type: 'number', required: true }),
      field({ key: 'fumante', type: 'boolean', required: true }),
      field({ key: 'inicio', type: 'date', required: false }),
      field({ key: 'tipo_sanguineo', type: 'select', options: ['A', 'B', 'AB', 'O'], required: true }),
      field({ key: 'alergias', type: 'multiselect', options: ['dipirona', 'penicilina'], required: false }),
    ];
    const answers = {
      queixa: 'Dor de cabeça',
      idade: 34,
      fumante: false,
      inicio: '2024-01-01',
      tipo_sanguineo: 'O',
      alergias: ['dipirona'],
    };

    expect(validateAnswers(fields, answers)).toEqual([]);
  });

  it('campo opcional pode ser omitido, vazio ou nulo sem gerar erro', () => {
    const fields = [field({ key: 'obs', required: false })];

    expect(validateAnswers(fields, {})).toEqual([]);
    expect(validateAnswers(fields, { obs: '' })).toEqual([]);
    expect(validateAnswers(fields, { obs: null as unknown as string })).toEqual([]);
  });

  it('campo obrigatório ausente, vazio ou nulo é reportado', () => {
    const fields = [field({ key: 'queixa', required: true })];

    expect(validateAnswers(fields, {})).toEqual([expect.stringContaining('"queixa"')]);
    expect(validateAnswers(fields, { queixa: '' })).toEqual([expect.stringContaining('"queixa"')]);
    expect(validateAnswers(fields, { queixa: null as unknown as string })).toEqual([
      expect.stringContaining('"queixa"'),
    ]);
  });

  it('chave que não existe no template é reportada, mas não impede checar o resto', () => {
    const fields = [field({ key: 'queixa', required: true })];

    const errors = validateAnswers(fields, { queixa: 'ok', campo_fantasma: 1 });

    expect(errors).toEqual([expect.stringContaining('campo_fantasma')]);
  });

  it.each([
    ['text', 42, 'texto'],
    ['textarea', 42, 'texto'],
    ['number', 'não é número', 'número'],
    ['number', Number.NaN, 'número'],
    ['boolean', 'sim', 'verdadeiro ou falso'],
    ['date', 'não é data', 'data válida'],
    ['date', 42, 'data válida'],
  ] as const)('tipo errado em campo %s é rejeitado', (type, value, expectedHint) => {
    const errors = validateAnswers([field({ key: 'x', type, required: true })], { x: value });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(expectedHint);
  });

  it('number aceita 0 (não confunde com "ausente")', () => {
    const fields = [field({ key: 'idade', type: 'number', required: true })];

    expect(validateAnswers(fields, { idade: 0 })).toEqual([]);
  });

  it('boolean aceita false (não confunde com "ausente")', () => {
    const fields = [field({ key: 'fumante', type: 'boolean', required: true })];

    expect(validateAnswers(fields, { fumante: false })).toEqual([]);
  });

  it('select recusa valor fora da lista de opções', () => {
    const fields = [field({ key: 'tipo', type: 'select', options: ['A', 'B'], required: true })];

    const errors = validateAnswers(fields, { tipo: 'Z' });

    expect(errors).toEqual([expect.stringContaining('A, B')]);
  });

  it('multiselect exige um array e recusa qualquer item fora das opções', () => {
    const fields = [field({ key: 'alergias', type: 'multiselect', options: ['a', 'b'] })];

    expect(validateAnswers(fields, { alergias: 'a' })).toEqual([expect.stringContaining('alergias')]);
    expect(validateAnswers(fields, { alergias: ['a', 'c'] })).toEqual([
      expect.stringContaining('alergias'),
    ]);
    expect(validateAnswers(fields, { alergias: [] })).toEqual([]);
    expect(validateAnswers(fields, { alergias: ['a', 'b'] })).toEqual([]);
  });

  it('acumula todos os erros de uma vez, não só o primeiro', () => {
    const fields = [
      field({ key: 'a', required: true }),
      field({ key: 'b', type: 'number', required: true }),
    ];

    const errors = validateAnswers(fields, { b: 'não é número', extra: 1 });

    expect(errors).toHaveLength(3);
  });
});
