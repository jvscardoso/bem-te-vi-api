import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(150)
  email!: string;

  // Mesmo papel do `host` do login: pelo endereço de uma clínica, só se recupera a senha de
  // usuários dela. Não define para onde o link aponta (ver AccountMailerService).
  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;
}
