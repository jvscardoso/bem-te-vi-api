export const ANAMNESIS_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
] as const;
export type AnamnesisFieldType = (typeof ANAMNESIS_FIELD_TYPES)[number];

// Forma persistida em AnamnesisTemplate.fields (Json). Validada por completo na escrita
// (create/update do template), então o resto do app pode confiar nela sem reconferir.
export interface AnamnesisFieldDefinition {
  key: string;
  label: string;
  type: AnamnesisFieldType;
  required: boolean;
  options?: string[];
}

const SELECT_TYPES = new Set<AnamnesisFieldType>(['select', 'multiselect']);

// select/multiselect sem opções não têm o que validar contra; pego aqui (400) em vez de
// deixar a inconsistência entrar no banco e só explodir quando alguém tentar preencher.
export function validateTemplateFields(fields: AnamnesisFieldDefinition[]): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    if (SELECT_TYPES.has(field.type) && (!field.options || field.options.length === 0)) {
      errors.push(`o campo "${field.key}" é do tipo ${field.type} e precisa de ao menos uma opção`);
    }
    if (!SELECT_TYPES.has(field.type) && field.options) {
      errors.push(`o campo "${field.key}" não é select/multiselect e não deveria ter opções`);
    }
  }
  return errors;
}

// Confere `answers` (o que o profissional preencheu) contra os campos do template: chave
// desconhecida, obrigatório faltando, tipo errado ou valor fora das opções — tudo reportado
// de uma vez (não só o primeiro problema), no mesmo espírito do class-validator.
export function validateAnswers(
  fields: AnamnesisFieldDefinition[],
  answers: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const byKey = new Map(fields.map((field) => [field.key, field]));

  for (const key of Object.keys(answers)) {
    if (!byKey.has(key)) {
      errors.push(`campo desconhecido: "${key}"`);
    }
  }

  for (const field of fields) {
    const value = answers[field.key];
    const present = value !== undefined && value !== null && value !== '';

    if (!present) {
      if (field.required) {
        errors.push(`"${field.key}" é obrigatório`);
      }
      continue;
    }

    const error = validateFieldValue(field, value);
    if (error) {
      errors.push(error);
    }
  }

  return errors;
}

function validateFieldValue(field: AnamnesisFieldDefinition, value: unknown): string | undefined {
  switch (field.type) {
    case 'text':
    case 'textarea':
      return typeof value === 'string' ? undefined : `"${field.key}" deve ser texto`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? undefined
        : `"${field.key}" deve ser um número`;
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `"${field.key}" deve ser verdadeiro ou falso`;
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? undefined
        : `"${field.key}" deve ser uma data válida`;
    case 'select':
      return typeof value === 'string' && field.options?.includes(value)
        ? undefined
        : `"${field.key}" deve ser uma destas opções: ${(field.options ?? []).join(', ')}`;
    case 'multiselect':
      return Array.isArray(value) && value.every((item) => field.options?.includes(item))
        ? undefined
        : `"${field.key}" deve ser uma lista contendo só estas opções: ${(field.options ?? []).join(', ')}`;
  }
}
