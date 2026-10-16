import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, registerDecorator } from 'class-validator';

// CPF (11 dígitos) ou CNPJ (14), com os dígitos verificadores conferidos. Recusa sequências de um
// dígito só (111.111.111-11), que passam no cálculo mas não existem.
export function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) {
    return false;
  }
  const digit = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(cpf[i]) * (length + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) {
    return false;
  }
  const digit = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, weight, i) => acc + Number(cnpj[i]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}

// Campo de CPF ou CNPJ: aceita com ou sem pontuação e guarda só os dígitos (mesma convenção do CPF
// do paciente).
export function IsCpfOrCnpj() {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value)),
    IsString(),
    (target: object, propertyName: string | symbol) =>
      registerDecorator({
        name: 'isCpfOrCnpj',
        target: target.constructor,
        propertyName: propertyName as string,
        options: { message: 'CPF ou CNPJ inválido' },
        validator: {
          validate: (value: unknown) => typeof value === 'string' && (isValidCpf(value) || isValidCnpj(value)),
        },
      }),
  );
}
