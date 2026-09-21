import { IsHexColor, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateTenantBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  tradeName?: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;
}
