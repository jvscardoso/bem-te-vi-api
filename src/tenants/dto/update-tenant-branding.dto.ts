import { IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

// #RRGGBB exato: a coluna é VarChar(7) e o frontend usa o valor direto em CSS.
// (IsHexColor aceitaria "#fff", "ff0000" e "#12345678", que estoura a coluna.)
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const HEX_COLOR_MESSAGE = 'deve estar no formato #RRGGBB';

// Todos os campos aceitam null para limpar o valor (IsOptional ignora null e undefined).
export class UpdateTenantBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  tradeName?: string | null;

  // Só https: o valor vai para <img src> do frontend (nada de http, ftp, data:, javascript:).
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  logoUrl?: string | null;

  @IsOptional()
  @Matches(HEX_COLOR, { message: `primaryColor ${HEX_COLOR_MESSAGE}` })
  primaryColor?: string | null;

  @IsOptional()
  @Matches(HEX_COLOR, { message: `secondaryColor ${HEX_COLOR_MESSAGE}` })
  secondaryColor?: string | null;
}
