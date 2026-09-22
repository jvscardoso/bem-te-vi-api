import { DnsTxtResolver } from './dns-txt-resolver.js';

const resolveTxt = vi.fn();
vi.mock('node:dns', () => ({ promises: { resolveTxt: (...args: unknown[]) => resolveTxt(...args) } }));

// Sem beforeEach(mockReset): cada teste já define sua própria implementação do mock, que
// substitui a anterior. (Um reset dentro de um hook `beforeEach`, especificamente, faz o
// vitest atribuir de forma incorreta uma unhandled rejection deste arquivo ao teste errado —
// reproduzido isoladamente fora deste arquivo; não é um bug do DnsTxtResolver.)
describe('DnsTxtResolver', () => {
  it('junta os fragmentos de um mesmo registro TXT numa única string', async () => {
    // Um TXT longo chega fragmentado (RFC 1035, chunks de até 255 bytes); node:dns devolve
    // um array por registro, cada um já como array de fragmentos.
    resolveTxt.mockResolvedValue([['abc', 'def']]);

    await expect(new DnsTxtResolver().resolveTxt('_bemtevi-challenge.exemplo.com')).resolves.toEqual([
      'abcdef',
    ]);
  });

  it('devolve um item por registro quando há mais de um TXT no mesmo host', async () => {
    resolveTxt.mockResolvedValue([['v=spf1 -all'], ['token-do-desafio']]);

    await expect(new DnsTxtResolver().resolveTxt('exemplo.com')).resolves.toEqual([
      'v=spf1 -all',
      'token-do-desafio',
    ]);
  });

  it('devolve lista vazia (não rejeita) quando o domínio não existe ou não tem TXT', async () => {
    resolveTxt.mockRejectedValue(Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' }));

    await expect(new DnsTxtResolver().resolveTxt('nao-existe.exemplo.com')).resolves.toEqual([]);
  });

  it('devolve lista vazia se o DNS não responder a tempo, sem travar a requisição', async () => {
    vi.useFakeTimers();
    resolveTxt.mockImplementation(() => new Promise(() => {})); // nunca resolve

    const pending = new DnsTxtResolver().resolveTxt('lento.exemplo.com');
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual([]);
    vi.useRealTimers();
  });
});
