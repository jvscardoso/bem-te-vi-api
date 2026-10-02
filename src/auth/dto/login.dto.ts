import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(150)
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;

  // Host de onde o frontend está sendo servido (window.location.host), o mesmo enviado a
  // GET /public/branding. Se ele resolver para uma clínica, só usuários dela entram por ali.
  // Opcional por compatibilidade (scripts, coleção do Postman, clientes antigos).
  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;
}
