import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MaxLength(150)
  name!: string;

  @IsEmail()
  @MaxLength(150)
  email!: string;

  // Sem senha = convite: o usuário nasce `invited` (não loga) e recebe por email um link para
  // definir a própria senha. Com senha, o admin a define e repassa (fluxo antigo).
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password?: string;

  @IsUUID('4')
  roleId!: string;

  // Duração padrão dos atendimentos deste profissional; null/ausente = usa a da clínica.
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  defaultAppointmentDurationMinutes?: number | null;
}
