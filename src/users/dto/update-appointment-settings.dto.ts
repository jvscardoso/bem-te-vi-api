import { IsInt, Max, Min, ValidateIf } from 'class-validator';

export class UpdateAppointmentSettingsDto {
  // null remove a configuração própria e volta a valer a duração padrão da clínica.
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(5)
  @Max(1440)
  defaultAppointmentDurationMinutes!: number | null;
}
