import { IsObject, IsUUID } from 'class-validator';

export class CreateAnamnesisRecordDto {
  // O formulário usado para preencher; suas answers são validadas contra os campos dele
  // (ver AnamnesisTemplatesController para consultar/criar formulários do tenant).
  @IsUUID('4')
  templateId!: string;

  @IsObject()
  answers!: Record<string, unknown>;
}
