import { PartialType } from '@nestjs/mapped-types';
import { CreateAnamnesisTemplateDto } from './create-anamnesis-template.dto.js';

export class UpdateAnamnesisTemplateDto extends PartialType(CreateAnamnesisTemplateDto) {}
