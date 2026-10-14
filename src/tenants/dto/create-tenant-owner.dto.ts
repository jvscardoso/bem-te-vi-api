import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { RequiredText } from '../../common/validation/required-text.decorator.js';

export class CreateTenantOwnerDto {
  @RequiredText(150)
  name!: string;

  @IsEmail()
  @MaxLength(150)
  email!: string;

  // Mesmo teto das outras rotas de senha. O bcrypt só considera os primeiros 72 bytes, e uma
  // senha enorme numa rota pública só serviria para gastar CPU com o hash.
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
