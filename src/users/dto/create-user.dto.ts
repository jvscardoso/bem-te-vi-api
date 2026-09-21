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

  @IsString()
  @MinLength(8)
  password!: string;

  @IsUUID('4')
  roleId!: string;

  // Duração padrão dos atendimentos deste profissional; null/ausente = usa a da clínica.
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  defaultAppointmentDurationMinutes?: number | null;
}
