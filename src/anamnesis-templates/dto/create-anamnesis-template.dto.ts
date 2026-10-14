import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, ValidateNested } from 'class-validator';
import { AnamnesisFieldDto } from './anamnesis-field.dto.js';
import { RequiredText } from '../../common/validation/required-text.decorator.js';

export class CreateAnamnesisTemplateDto {
  @RequiredText(100)
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ArrayUnique((field: AnamnesisFieldDto) => field.key, { message: 'As chaves dos campos (key) devem ser únicas' })
  @ValidateNested({ each: true })
  @Type(() => AnamnesisFieldDto)
  fields!: AnamnesisFieldDto[];
}
