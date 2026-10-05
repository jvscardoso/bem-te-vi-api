import { IsString, MaxLength } from 'class-validator';

// Senha de quem pede o encerramento: confirmação extra para um passo que leva à exclusão.
export class RequestClosureDto {
  @IsString()
  @MaxLength(200)
  password!: string;
}
