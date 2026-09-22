import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ANAMNESIS_FIELD_TYPES, type AnamnesisFieldType } from '../anamnesis-answers.validator.js';

export class AnamnesisFieldDto {
  // snake_case: vira a chave em `answers` (JSON) e em objetos JS — evita espaço, acento,
  // maiúscula ou símbolo que compliquem isso em qualquer client.
  @IsString()
  @MaxLength(60)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'key deve começar com letra minúscula e conter só letras minúsculas, números e "_"',
  })
  key!: string;

  @IsString()
  @MaxLength(150)
  label!: string;

  @IsEnum(ANAMNESIS_FIELD_TYPES)
  type!: AnamnesisFieldType;

  @IsBoolean()
  required!: boolean;

  // Obrigatório para select/multiselect e proibido nos demais tipos — checado no serviço
  // (validateTemplateFields), não aqui: é uma regra entre dois campos do mesmo objeto.
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  options?: string[];
}
