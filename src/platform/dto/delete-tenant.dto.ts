import { IsString, MaxLength } from 'class-validator';

// O admin da plataforma digita o subdomínio da clínica para confirmar: proteção contra excluir
// a clínica errada por um id copiado por engano. A exclusão não tem volta.
export class DeleteTenantDto {
  @IsString()
  @MaxLength(63)
  confirmSubdomain!: string;
}
