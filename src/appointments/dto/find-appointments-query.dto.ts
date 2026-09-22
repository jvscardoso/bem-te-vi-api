import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AppointmentStatus } from '@prisma/client';

// "a,b" ou repetido (?status=a&status=b) -> ['a', 'b'], sem duplicados. Vazio = sem filtro.
// O que não for texto passa intacto e cai na validação do enum (400).
const toStatusList = ({ value }: { value: unknown }) => {
  const parts = (Array.isArray(value) ? value : [value])
    .flatMap((item: unknown) => (typeof item === 'string' ? item.split(',') : [item]))
    .map((item: unknown) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== '');
  return parts.length > 0 ? [...new Set(parts)] : undefined;
};

export class FindAppointmentsQueryDto {
  @IsOptional()
  @IsUUID('4')
  professionalId?: string;

  @IsOptional()
  @IsUUID('4')
  patientId?: string;

  // Janela [from, to]: entram os agendamentos que ocupam algum instante dela, isto é,
  // terminam depois de `from` (um que termina exatamente em `from` só encosta) e começam
  // até `to` (inclusive). Qualquer um dos dois pode ser omitido.
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Um ou mais status: ?status=scheduled,confirmed (ou repetido). Sem o parâmetro, todos.
  @IsOptional()
  @Transform(toStatusList)
  @IsEnum(AppointmentStatus, { each: true })
  status?: AppointmentStatus[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page: number = 1;

  // Teto maior que o dos pacientes: uma visão de calendário (um profissional numa semana)
  // precisa de muitos itens numa só requisição.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 50;
}
