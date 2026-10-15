import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, registerDecorator } from 'class-validator';

// Nome canônico de um fuso IANA ("america/sao_paulo" → "America/Sao_Paulo"), ou null se o Node
// não o conhece. Usa o próprio Intl, então a lista de fusos é a do runtime, sempre atualizada.
export function canonicalTimeZone(value: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

// Fuso IANA válido, gravado no nome canônico. Deslocamentos fixos ("-03:00", "GMT-3") ficam de
// fora de propósito: não acompanham horário de verão.
export function IsIanaTimeZone() {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? (canonicalTimeZone(value.trim()) ?? value) : value)),
    IsString(),
    MaxLength(64),
    (target: object, propertyName: string | symbol) =>
      registerDecorator({
        name: 'isIanaTimeZone',
        target: target.constructor,
        propertyName: propertyName as string,
        options: { message: 'Fuso horário inválido: use um nome IANA, como America/Sao_Paulo' },
        validator: {
          validate: (value: unknown) =>
            typeof value === 'string' && value.includes('/') && canonicalTimeZone(value) === value,
        },
      }),
  );
}

// Data de hoje (AAAA-MM-DD) no fuso informado, como Date à meia-noite UTC: é a forma em que o
// Prisma devolve as colunas @db.Date (ex.: vencimento de cobrança), para comparar direto.
export function todayIn(timeZone: string, now = new Date()): Date {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${date}T00:00:00.000Z`);
}
