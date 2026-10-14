import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

export const WIDGET_WIDTHS = ['full', 'two-thirds', 'half', 'third'] as const;
export type WidgetWidth = (typeof WIDGET_WIDTHS)[number];

// Versão do formato do layout. Uma mudança incompatível no formato vira a versão 2, e a API passa
// a aceitar as duas enquanto o front migra.
export const LAYOUT_VERSIONS = [1] as const;

export class LayoutWidgetDto {
  // Gerado pelo front, para identificar o bloco na edição (arrastar, remover).
  @IsString()
  @Length(1, 40)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: 'O id do bloco deve ter só letras, números, "_" e "-"' })
  id!: string;

  // O catálogo de blocos é do front: a API só confere o formato, não se o tipo existe. Bloco novo
  // no front não exige mudança aqui, e o front ignora os tipos que não conhece mais.
  @IsString()
  @Length(1, 50)
  @Matches(/^[a-z0-9-]+$/, { message: 'O tipo do bloco deve ter só letras minúsculas, números e "-"' })
  type!: string;

  @IsIn(WIDGET_WIDTHS)
  width!: WidgetWidth;
}

export class SaveLayoutDto {
  @IsInt()
  @IsIn(LAYOUT_VERSIONS)
  version!: number;

  // Vazio é válido: a tela fica sem blocos.
  @IsArray()
  @ArrayMaxSize(24)
  @ArrayUnique((widget: LayoutWidgetDto) => widget.id, { message: 'Os ids dos blocos devem ser únicos' })
  @ValidateNested({ each: true })
  @Type(() => LayoutWidgetDto)
  widgets!: LayoutWidgetDto[];
}
