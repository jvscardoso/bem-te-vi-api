import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto.js';

// PaginationQueryDto + busca livre (`q`), para listagens paginadas que também precisam de
// busca (ex.: tenants no backoffice). Mesmas regras de ListPatientsQueryDto.
export class SearchPaginationQueryDto extends PaginationQueryDto {
  @IsOptional()
  // NUL (\0) não existe em texto do Postgres: chegaria como erro 500 do banco.
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\0/g, '').trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;
}
