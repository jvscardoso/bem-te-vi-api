// Logo de clínica: imagem pequena, guardada no banco (TenantLogo). O limite protege o banco e
// os backups; 1 MB sobra para um logo (normalmente dezenas de KB).
export const LOGO_MAX_BYTES = 1024 * 1024;

// Tipo detectado pelos primeiros bytes (assinatura do formato), nunca pelo Content-Type ou pela
// extensão que o cliente declara — esses são escolhidos por quem envia. SVG fica de fora de
// propósito: é XML que pode carregar <script>, e servido pela API abriria XSS no domínio dela.
export function detectLogoMimeType(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
