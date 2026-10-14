import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Endereços da própria plataforma. Uma clínica com um desses subdomínios passaria a "ser dona"
// do host na marca pública e no login (TenantHostResolver), sequestrando o endereço da API,
// da landing, do backoffice ou do email. RESERVED_SUBDOMAINS acrescenta outros por ambiente.
const BASE_RESERVED_SUBDOMAINS = [
  'www',
  'api',
  'app',
  'admin',
  'backoffice',
  'plataforma',
  'mail',
  'smtp',
  'status',
  'docs',
  'blog',
  'ajuda',
  'suporte',
  'static',
  'cdn',
  'assets',
];

// Regras sobre os endereços que uma clínica pode reivindicar no cadastro e nas configurações.
// O conflito com outra clínica continua vindo da unique do banco (PrismaExceptionFilter); aqui
// fica o que não é de clínica nenhuma. Mesmo status (409) e a mesma forma de mensagem, para a
// tela tratar os dois casos igual.
@Injectable()
export class TenantAddressPolicy {
  constructor(private readonly config: ConfigService) {}

  assertSubdomainAvailable(subdomain: string) {
    const extra = (this.config.get<string>('RESERVED_SUBDOMAINS') ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase());
    if (BASE_RESERVED_SUBDOMAINS.includes(subdomain) || extra.includes(subdomain)) {
      throw new ConflictException('Este subdomínio não está disponível');
    }
  }

  // O domínio da plataforma e os subdomínios dele já são resolvidos pela regra de subdomínio:
  // como domínio próprio, um "algo.<APP_BASE_DOMAIN>" contornaria a lista de reservados.
  assertCustomDomainAvailable(domain: string) {
    const baseDomain = this.config.get<string>('APP_BASE_DOMAIN')?.trim().toLowerCase();
    if (baseDomain && (domain === baseDomain || domain.endsWith(`.${baseDomain}`))) {
      throw new ConflictException('Este domínio não está disponível');
    }
  }
}
