import { IsObject } from 'class-validator';

export class CreateAnamnesisRecordDto {
  @IsObject()
  answers!: Record<string, unknown>;
}
