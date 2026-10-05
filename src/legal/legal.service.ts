import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LegalDocument } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestContext } from '../common/request-context/request-context.js';
import type { Db } from '../access/access-policy.service.js';
import type { LegalAcceptanceDto } from './dto/legal-acceptance.dto.js';

const DOCUMENTS: LegalDocument[] = ['terms', 'privacy'];

// Termos de Uso e Política de Privacidade da plataforma. Os textos vivem no frontend; aqui só
// a versão vigente de cada um (LEGAL_TERMS_VERSION / LEGAL_PRIVACY_VERSION) e a prova de aceite.
// Mudou o texto? Suba a versão: todo mundo passa a ter aceite pendente (ver `pending`).
@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  currentVersions(): Record<LegalDocument, string> {
    return {
      terms: this.config.get<string>('LEGAL_TERMS_VERSION')?.trim() || '1',
      privacy: this.config.get<string>('LEGAL_PRIVACY_VERSION')?.trim() || '1',
    };
  }

  // 400 se a pessoa aceitou uma versão que não é a vigente.
  assertCurrent(dto: LegalAcceptanceDto) {
    const current = this.currentVersions();
    if (dto.termsVersion !== current.terms || dto.privacyVersion !== current.privacy) {
      throw new BadRequestException(
        `Aceite a versão vigente dos Termos de Uso (${current.terms}) e da Política de Privacidade (${current.privacy})`,
      );
    }
  }

  // Grava os dois aceites com IP e navegador da requisição. Use dentro da transação de quem
  // cria o usuário (cadastro, convite): sem aceite registrado, nada é criado.
  async record(db: Db, user: { id: string; tenantId: string }, dto: LegalAcceptanceDto) {
    this.assertCurrent(dto);
    const { ip, userAgent } = RequestContext.current();
    await db.legalAcceptance.createMany({
      data: [
        { userId: user.id, tenantId: user.tenantId, document: 'terms', version: dto.termsVersion, ip, userAgent },
        { userId: user.id, tenantId: user.tenantId, document: 'privacy', version: dto.privacyVersion, ip, userAgent },
      ],
    });
  }

  // Documentos cuja versão vigente o usuário ainda não aceitou (nunca aceitou, ou a versão
  // mudou). O frontend bloqueia o uso até o aceite; a API não bloqueia as demais rotas.
  async pending(userId: string): Promise<LegalDocument[]> {
    const current = this.currentVersions();
    const accepted = await this.prisma.legalAcceptance.findMany({
      where: { userId, OR: DOCUMENTS.map((document) => ({ document, version: current[document] })) },
      select: { document: true },
    });
    const done = new Set(accepted.map((row) => row.document));
    return DOCUMENTS.filter((document) => !done.has(document));
  }
}
