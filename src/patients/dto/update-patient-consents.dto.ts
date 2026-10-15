import { IsBoolean, IsOptional } from 'class-validator';

// Envio parcial: só as finalidades enviadas mudam. Sem nenhuma, 400 (ver o controller).
export class UpdatePatientConsentsDto {
  // Aceita receber mensagens da clínica por WhatsApp sobre o atendimento (lembrete, confirmação).
  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;

  // Aceita receber campanhas de marketing.
  @IsOptional()
  @IsBoolean()
  marketing?: boolean;
}
