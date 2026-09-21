import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTenantOwnerDto {
  @IsString()
  @MaxLength(150)
  name!: string;

  @IsEmail()
  @MaxLength(150)
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
