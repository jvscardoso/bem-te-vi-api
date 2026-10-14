import { clinicBaseUrl, clinicLink, type ClinicAddress } from './clinic-url.js';

const tenant: ClinicAddress = { subdomain: 'clinica-sao-jose', customDomain: null, customDomainVerifiedAt: null };
const link = (settings: Parameters<typeof clinicBaseUrl>[1], t = tenant) =>
  clinicLink(clinicBaseUrl(t, settings), '/accept-invite', 'abc');

describe('clinicBaseUrl / clinicLink', () => {
  it('dev com FRONTEND_URL em localhost: a clínica vai no host, com a mesma porta e sem ?tenant=', () => {
    expect(link({ frontendUrl: 'http://localhost:5173' })).toBe(
      'http://clinica-sao-jose.localhost:5173/accept-invite?token=abc',
    );
    // Sem FRONTEND_URL, o padrão é o mesmo localhost:5173 (e barra no fim não atrapalha).
    expect(link({})).toBe('http://clinica-sao-jose.localhost:5173/accept-invite?token=abc');
    expect(link({ frontendUrl: 'http://localhost:5173/' })).toBe(
      'http://clinica-sao-jose.localhost:5173/accept-invite?token=abc',
    );
  });

  it('dev com FRONTEND_URL por IP (celular na rede local): mantém ?tenant=', () => {
    expect(link({ frontendUrl: 'http://192.168.0.10:5173' })).toBe(
      'http://192.168.0.10:5173/accept-invite?token=abc&tenant=clinica-sao-jose',
    );
  });

  it('com APP_BASE_DOMAIN: https://<sub>.<base>, ignorando o FRONTEND_URL', () => {
    expect(link({ baseDomain: 'BemTeVi.app ', frontendUrl: 'http://localhost:5173' })).toBe(
      'https://clinica-sao-jose.bemtevi.app/accept-invite?token=abc',
    );
  });

  it('domínio próprio verificado tem preferência; não verificado é ignorado', () => {
    const verified = { ...tenant, customDomain: 'agenda.clinica.com.br', customDomainVerifiedAt: new Date() };
    expect(link({ baseDomain: 'bemtevi.app' }, verified)).toBe('https://agenda.clinica.com.br/accept-invite?token=abc');
    expect(link({ frontendUrl: 'http://localhost:5173' }, verified)).toBe(
      'https://agenda.clinica.com.br/accept-invite?token=abc',
    );

    const unverified = { ...verified, customDomainVerifiedAt: null };
    expect(link({ baseDomain: 'bemtevi.app' }, unverified)).toBe(
      'https://clinica-sao-jose.bemtevi.app/accept-invite?token=abc',
    );
  });
});
