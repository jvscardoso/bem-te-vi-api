import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(150)
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}
