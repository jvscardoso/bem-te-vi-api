import { Type } from 'class-transformer';
import { IsObject, ValidateNested } from 'class-validator';
import { TokenPasswordDto } from './token-password.dto.js';
import { LegalAcceptanceDto } from '../../legal/dto/legal-acceptance.dto.js';

// Quem aceita o convite também aceita os Termos e a Política vigentes: é o primeiro acesso
// da pessoa, igual ao dono no cadastro da clínica.
export class AcceptInviteDto extends TokenPasswordDto {
  @IsObject()
  @ValidateNested()
  @Type(() => LegalAcceptanceDto)
  legalAcceptance!: LegalAcceptanceDto;
}
