import { Controller, Get, Header, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';
import { PublicBrandingService } from './public-branding.service.js';
import { ResolveBrandingQueryDto } from './dto/resolve-branding-query.dto.js';

// Pública de propósito: o frontend precisa da marca da clínica para desenhar a tela de login,
// antes de existir token.
@Public()
@Controller('public/branding')
export class PublicBrandingController {
  constructor(private readonly brandingService: PublicBrandingService) {}

  @Header('Cache-Control', 'public, max-age=60')
  @Get()
  resolve(@Query() query: ResolveBrandingQueryDto) {
    return this.brandingService.resolve(query.host);
  }
}
