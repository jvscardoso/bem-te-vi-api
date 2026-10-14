import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Texto obrigatório (nome de clínica, de paciente, de papel...): sem espaços nas pontas e não
// vazio depois disso. Só `@IsString()` aceitaria "" e "   ", e o registro nasceria sem nome.
// Nos DTOs de update (PartialType), o campo continua opcional, mas, se vier, não pode vir vazio.
export function RequiredText(maxLength: number) {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)),
    IsString(),
    IsNotEmpty(),
    MaxLength(maxLength),
  );
}
