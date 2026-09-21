import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { UserStatus } from '@prisma/client';
import { CreateUserDto } from './create-user.dto.js';

export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['password'] as const)) {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
