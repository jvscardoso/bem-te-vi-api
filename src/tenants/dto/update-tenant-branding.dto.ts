import { IsOptional, IsUrl, Matches, MaxLength } from 'class-validator';
import { RequiredText } from '../../common/validation/required-text.decorator.js';

// #RRGGBB exato: a coluna é VarChar(7) e o frontend usa o valor direto em CSS.
// (IsHexColor aceitaria "#fff", "ff0000" e "#12345678", que estoura a coluna.)
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const HEX_COLOR_MESSAGE = 'deve estar no formato #RRGGBB';

// Todos os campos aceitam null para limpar o valor (IsOptional ignora null e undefined).
export class UpdateTenantBrandingDto {
  // Para limpar, null: "" ou só espaços virariam um nome fantasia vazio no lugar do nome da clínica.
  @IsOptional()
  @RequiredText(150)
  tradeName?: string | null;

  // Só https: o valor vai para <img src> do frontend (nada de http, ftp, data:, javascript:).
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  logoUrl?: string | null;

  @IsOptional()
  @Matches(HEX_COLOR, { message: `A cor primária ${HEX_COLOR_MESSAGE}` })
  primaryColor?: string | null;

  @IsOptional()
  @Matches(HEX_COLOR, { message: `A cor secundária ${HEX_COLOR_MESSAGE}` })
  secondaryColor?: string | null;
}
