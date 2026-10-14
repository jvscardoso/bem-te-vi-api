import { ArrayUnique, IsArray, IsOptional, IsString, IsUUID } from 'class-validator';
import { RequiredText } from '../../common/validation/required-text.decorator.js';

export class CreateRoleDto {
  @RequiredText(80)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  permissionIds?: string[];
}
