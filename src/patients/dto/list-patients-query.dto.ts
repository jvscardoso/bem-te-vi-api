import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListPatientsQueryDto {
  // Busca livre: cada palavra precisa casar. Palavras com letras casam no nome (qualquer
  // ordem, sem diferenciar maiúsculas/acentos); palavras só com dígitos/pontuação, no CPF.
  @IsOptional()
  // NUL (\0) não existe em texto do Postgres: chegaria como erro 500 do banco.
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\0/g, '').trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}
