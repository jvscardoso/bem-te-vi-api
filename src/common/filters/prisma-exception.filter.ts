import { ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

// Mensagens amigáveis por constraint única (nome do índice no Postgres).
const UNIQUE_MESSAGES: Record<string, string> = {
  patients_tenant_id_cpf_key: 'Já existe um paciente com este CPF',
  users_email_key: 'Já existe um usuário com este email',
  roles_tenant_id_name_key: 'Já existe um papel com este nome',
  tenants_subdomain_key: 'Este subdomínio já está em uso',
  tenants_custom_domain_key: 'Este domínio já está em uso',
};

// Traduz erros conhecidos do Prisma em respostas HTTP corretas em vez de 500.
// Os demais (conexão, bug, etc.) seguem para o handler padrão do Nest.
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const mapped = this.map(exception);
    if (!mapped) {
      return super.catch(exception, host);
    }

    host
      .switchToHttp()
      .getResponse<Response>()
      .status(mapped.status)
      .json({ statusCode: mapped.status, error: mapped.error, message: mapped.message });
  }

  private map(exception: Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: UNIQUE_MESSAGES[this.constraintName(exception) ?? ''] ?? 'Registro duplicado',
        };
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'Operação bloqueada: o registro está em uso por outros dados',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          error: 'Not Found',
          message: 'Registro não encontrado',
        };
      default:
        return null;
    }
  }

  // Com o driver adapter (pg) o nome do índice vem em meta.driverAdapterError, não em meta.target.
  private constraintName(exception: Prisma.PrismaClientKnownRequestError): string | undefined {
    const meta = exception.meta as
      | { driverAdapterError?: { cause?: { constraint?: { index?: string } } } }
      | undefined;
    return meta?.driverAdapterError?.cause?.constraint?.index;
  }
}
