import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';
import { LegalService } from './legal.service.js';

// Pública: a tela de cadastro e a de aceite de convite precisam das versões vigentes antes de
// existir token, para enviá-las junto com o aceite.
@Public()
@Controller('public/legal')
export class PublicLegalController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  current() {
    const versions = this.legal.currentVersions();
    return { terms: { version: versions.terms }, privacy: { version: versions.privacy } };
  }
}
