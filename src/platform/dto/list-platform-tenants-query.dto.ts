import { IsIn, IsOptional } from 'class-validator';
import { SearchPaginationQueryDto } from '../../common/pagination/search-pagination-query.dto.js';

// requested: pediram o encerramento (em carência ou não); deletable: já passaram da carência e
// podem ser excluídas definitivamente.
export const CLOSURE_FILTERS = ['requested', 'deletable'] as const;
export type ClosureFilter = (typeof CLOSURE_FILTERS)[number];

export class ListPlatformTenantsQueryDto extends SearchPaginationQueryDto {
  @IsOptional()
  @IsIn(CLOSURE_FILTERS)
  closure?: ClosureFilter;
}
