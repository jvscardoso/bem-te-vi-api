import { IsString, MaxLength, MinLength } from 'class-validator';

// Corpo de "redefinir senha" e "aceitar convite": o token do link do email + a senha nova.
export class TokenPasswordDto {
  @IsString()
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
