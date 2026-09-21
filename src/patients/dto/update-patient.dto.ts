import { PartialType } from '@nestjs/mapped-types';
import { CreatePatientDto } from './create-patient.dto.js';

export class UpdatePatientDto extends PartialType(CreatePatientDto) {}
