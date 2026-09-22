import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AnamnesisFieldDto } from './anamnesis-field.dto.js';

export class CreateAnamnesisTemplateDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ArrayUnique((field: AnamnesisFieldDto) => field.key, { message: 'as chaves dos campos (key) devem ser únicas' })
  @ValidateNested({ each: true })
  @Type(() => AnamnesisFieldDto)
  fields!: AnamnesisFieldDto[];
}
