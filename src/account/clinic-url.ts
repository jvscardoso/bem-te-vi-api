// Endereço do frontend de uma clínica, para os links dos emails de conta. Nunca vem do request
// (ver AccountMailerService).
export interface ClinicAddress {
  subdomain: string;
  customDomain: string | null;
  customDomainVerifiedAt: Date | null;
}

export interface FrontendSettings {
  // APP_BASE_DOMAIN (produção): "<sub>.<base>".
  baseDomain?: string;
  // FRONTEND_URL (dev, sem APP_BASE_DOMAIN).
  frontendUrl?: string;
}

export interface ClinicBaseUrl {
  origin: string;
  // Clínica em ?tenant=, quando o host não tem como carregar o subdomínio (dev por IP).
  tenant?: string;
}

// Mesma ordem de preferência da resolução de marca: domínio próprio verificado, depois
// <sub>.<APP_BASE_DOMAIN>. Em dev (sem APP_BASE_DOMAIN):
// - FRONTEND_URL em localhost: a clínica vai no host (<sub>.localhost, mesma porta), como o front
//   roda em dev; o Chrome e o Firefox resolvem *.localhost sem configurar nada;
// - qualquer outro host (ex.: um IP, para testar pelo celular na rede local): FRONTEND_URL com
//   ?tenant=<sub>, porque um IP não tem subdomínio.
export function clinicBaseUrl(tenant: ClinicAddress, settings: FrontendSettings): ClinicBaseUrl {
  if (tenant.customDomain && tenant.customDomainVerifiedAt) {
    return { origin: `https://${tenant.customDomain}` };
  }
  const baseDomain = settings.baseDomain?.trim().toLowerCase();
  if (baseDomain) {
    return { origin: `https://${tenant.subdomain}.${baseDomain}` };
  }
  const frontend = new URL(settings.frontendUrl?.trim() || 'http://localhost:5173');
  if (frontend.hostname === 'localhost') {
    frontend.hostname = `${tenant.subdomain}.localhost`;
    return { origin: frontend.origin };
  }
  return { origin: frontend.origin, tenant: tenant.subdomain };
}

// Link para uma rota do frontend que recebe o token (?token=...).
export function clinicLink(baseUrl: ClinicBaseUrl, path: string, token: string): string {
  const url = new URL(path, baseUrl.origin);
  url.searchParams.set('token', token);
  if (baseUrl.tenant) {
    url.searchParams.set('tenant', baseUrl.tenant);
  }
  return url.toString();
}
