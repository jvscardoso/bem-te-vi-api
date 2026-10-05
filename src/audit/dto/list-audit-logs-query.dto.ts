import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { AUDIT_ACTIONS, type AuditAction } from '../audit.service.js';

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  // "Quem acessou os dados deste paciente?" — o pedido típico de um titular (LGPD).
  @IsOptional()
  @IsUUID('4')
  patientId?: string;

  // "O que este usuário acessou?" — investigação de acesso indevido.
  @IsOptional()
  @IsUUID('4')
  actorUserId?: string;

  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: AuditAction;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
