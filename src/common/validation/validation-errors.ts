import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { getMetadataStorage, type ValidationError } from 'class-validator';
import { fieldLabel, type FieldLabel } from './field-labels.js';

// Um erro por campo, para o cliente marcar o campo certo na tela:
// - `field`: caminho do campo no corpo ou na query ("owner.email", "fields.0.key");
// - `code`: a regra que falhou, estável para o cliente traduzir ou tratar por conta própria.
//   É o nome da regra do class-validator (isEmail, minLength, maxLength, isUUID...), mais
//   `required` (campo ausente ou vazio) e `unknownField` (campo que a rota não aceita);
// - `message`: a mesma frase em português que vai em `message`, pronta para exibir.
export interface FieldError {
  field: string;
  code: string;
  message: string;
}

// Com várias regras quebradas no mesmo campo, só a mais básica vira mensagem: para um nome
// ausente, "é obrigatório" basta; "deve ser um texto" e "no máximo 150" seriam ruído.
const PRIORITY = [
  'isDefined',
  'isNotEmpty',
  'isString',
  'isInt',
  'isNumber',
  'isBoolean',
  'isObject',
  'isArray',
  'nestedValidation',
  'isDateString',
  'isEmail',
  'isUUID',
  'isEnum',
  'isIn',
];

// Corpo do 400 de validação. `message` continua sendo a lista de frases (o formato de antes),
// agora em português; `errors` é o mesmo conteúdo estruturado.
export function validationExceptionFactory(errors: ValidationError[]) {
  const fieldErrors = collect(errors, '');
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: fieldErrors.map((e) => e.message),
    errors: fieldErrors,
  });
}

// Mesma configuração em toda a API (registrada como APP_PIPE no AppModule, então os testes e2e
// usam exatamente a mesma): campo fora do DTO é 400, tipos convertidos, erros em português.
export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    exceptionFactory: validationExceptionFactory,
  });
}

function collect(errors: ValidationError[], parentPath: string): FieldError[] {
  return errors.flatMap((error) => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = error.constraints ? [describe(error, path)] : [];
    return [...own, ...collect(error.children ?? [], path)];
  });
}

function describe(error: ValidationError, path: string): FieldError {
  const constraints = error.constraints!;
  const keys = Object.keys(constraints);
  const className = error.target?.constructor?.name;
  const label = fieldLabel(className, error.property);

  if (keys.includes('whitelistValidation')) {
    return { field: path, code: 'unknownField', message: `O campo "${path}" não é permitido` };
  }
  if (error.value === undefined || error.value === null || keys.includes('isNotEmpty')) {
    return { field: path, code: 'required', message: `${label.label} é ${gendered(label, 'obrigatório')}` };
  }

  const code = PRIORITY.find((key) => keys.includes(key)) ?? keys[0];
  const metadata = error.target
    ? getMetadataStorage()
        .getTargetValidationMetadatas(error.target.constructor, '', true, false)
        .find((meta) => meta.propertyName === error.property && meta.name === code)
    : undefined;

  // Regra com mensagem própria no DTO (ex.: o formato do subdomínio): ela já está em português
  // e diz mais do que a frase genérica.
  if (metadata?.message) {
    return { field: path, code, message: constraints[code] };
  }

  const args = metadata?.constraints ?? [];
  const message = metadata?.each ? translateEach(code, label, args) : translate(code, label, args);
  return { field: path, code, message };
}

// Regra aplicada a cada item de uma lista (`{ each: true }`), ex.: as opções de um campo.
function translateEach(code: string, label: FieldLabel, [arg]: unknown[]): string {
  switch (code) {
    case 'isString':
      return `${label.label} deve conter só textos`;
    case 'maxLength':
      return `${label.label} tem item com mais de ${String(arg)} caracteres`;
    default:
      return `${label.label} tem item inválido`;
  }
}

function translate(code: string, label: FieldLabel, args: unknown[]): string {
  const name = label.label;
  const [arg] = args;
  switch (code) {
    case 'isString':
      return `${name} deve ser um texto`;
    case 'isInt':
      return `${name} deve ser um número inteiro`;
    case 'isNumber':
      return `${name} deve ser um número`;
    case 'isBoolean':
      return `${name} deve ser verdadeiro ou falso`;
    case 'isObject':
    case 'nestedValidation':
      return `${name} deve ser um objeto`;
    case 'isArray':
      return `${name} deve ser uma lista`;
    case 'isDateString':
    case 'isISO8601':
    case 'isDate':
      return `${name} deve ser uma data válida`;
    case 'minLength':
      return `${name} deve ter pelo menos ${String(arg)} caracteres`;
    case 'maxLength':
      return `${name} deve ter no máximo ${String(arg)} caracteres`;
    case 'min':
      return `${name} deve ser no mínimo ${String(arg)}`;
    case 'max':
      return `${name} deve ser no máximo ${String(arg)}`;
    case 'arrayNotEmpty':
      return `${name} não pode ser ${gendered(label, 'vazio')}`;
    case 'arrayMinSize':
      return `${name} deve ter pelo menos ${String(arg)} itens`;
    case 'arrayMaxSize':
      return `${name} deve ter no máximo ${String(arg)} itens`;
    case 'arrayUnique':
      return `${name} não pode ter itens repetidos`;
    case 'isEnum':
    case 'isIn': {
      const values = arg && typeof arg === 'object' ? Object.values(arg as object) : [];
      const accepted = values.length > 0 ? `. Valores aceitos: ${values.join(', ')}` : '';
      return `${name} ${gendered(label, 'inválido')}${accepted}`;
    }
    default:
      // isEmail, isUUID, isFQDN, isUrl e qualquer outra regra sem frase própria.
      return `${name} ${gendered(label, 'inválido')}`;
  }
}

// "inválido" → "inválida", "obrigatório" → "obrigatória", conforme o campo.
function gendered(label: FieldLabel, masculine: string): string {
  return label.feminine ? `${masculine.slice(0, -1)}a` : masculine;
}
