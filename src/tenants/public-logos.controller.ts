import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';
import { TenantLogoService } from './tenant-logo.service.js';

// Serve os logos enviados por upload (ver TenantLogoService). Pública: a tela de login mostra o
// logo antes de existir token.
@Public()
@Controller('public/logos')
export class PublicLogosController {
  constructor(private readonly logos: TenantLogoService) {}

  // O id muda a cada upload: o conteúdo de uma URL nunca muda, então o cache pode ser eterno.
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  // O helmet põe `same-origin` em tudo, o que faria o navegador bloquear o <img> do frontend
  // (outra origem). Só esta rota libera: é uma imagem pública por natureza.
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  // O helmet já manda, mas a rota que devolve bytes enviados por usuário não depende disso:
  // o navegador nunca "adivinha" outro tipo (ex.: HTML) a partir do conteúdo.
  @Header('X-Content-Type-Options', 'nosniff')
  @Get(':id')
  async find(@Param('id') id: string) {
    const logo = await this.logos.find(id);
    return new StreamableFile(Buffer.from(logo.data), { type: logo.mimeType, disposition: 'inline' });
  }
}
