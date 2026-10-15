// Telefone do paciente em formato internacional (E.164, ex.: +5561988887777), a partir do que foi
// digitado (texto livre: "(61) 98888-7777", "61988887777", "+1 415 555 2671"). É por ele que uma
// mensagem de WhatsApp que chega é ligada ao paciente.
//   - com "+" na frente: número internacional, como veio (8 a 15 dígitos);
//   - sem "+": número brasileiro. Tira um "0" de discagem na frente; 10 ou 11 dígitos (DDD +
//     número) ganham o +55; 12 ou 13 começando com 55 já têm o código do país.
// O que não se encaixa vira null: o telefone continua guardado como foi digitado, só não serve
// para ligar o paciente a uma conversa. A migration phase0_timezone_phone_consents aplica a mesma
// regra em SQL aos pacientes que já existiam (um teste confere que as duas concordam).
export function normalizePhone(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const local = digits.startsWith('0') ? digits.slice(1) : digits;
  if (local.length === 10 || local.length === 11) {
    return `+55${local}`;
  }
  if ((local.length === 12 || local.length === 13) && local.startsWith('55')) {
    return `+${local}`;
  }
  return null;
}
