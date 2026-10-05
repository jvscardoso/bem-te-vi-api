import { IsString, MaxLength } from 'class-validator';

// Versões que a pessoa viu e aceitou na tela (vindas de GET /public/legal). Precisam ser as
// vigentes: aceitar uma versão velha não vale (o texto pode ter mudado desde que a tela abriu).
export class LegalAcceptanceDto {
  @IsString()
  @MaxLength(50)
  termsVersion!: string;

  @IsString()
  @MaxLength(50)
  privacyVersion!: string;
}
