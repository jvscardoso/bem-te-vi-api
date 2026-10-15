import { normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it.each([
    ['(61) 98888-7777', '+5561988887777'],
    ['61988887777', '+5561988887777'],
    ['(61) 3344-5566', '+556133445566'],
    ['061 98888-7777', '+5561988887777'],
    ['55 61 98888-7777', '+5561988887777'],
    ['+55 (61) 98888-7777', '+5561988887777'],
    ['+1 415 555 2671', '+14155552671'],
    ['  (11) 91234-5678  ', '+5511912345678'],
  ])('%j → %j', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', '1234', '98888-7777', '+123', 'telefone', '1234567890123456'])(
    '%j não é um número reconhecível → null',
    (raw) => {
      expect(normalizePhone(raw)).toBeNull();
    },
  );
});
