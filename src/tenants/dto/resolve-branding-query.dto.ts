import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResolveBrandingQueryDto {
  // Host de onde o frontend está sendo servido (ex.: "clinica-a.bemtevi.com.br" ou o
  // domínio próprio "agenda.clinica.com.br"). Porta e maiúsculas são normalizadas.
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host!: string;
}
