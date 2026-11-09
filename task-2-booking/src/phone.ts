// @rev kc-31
const ALLOWED = /^[+\d\s()-]+$/;

// Казахстанский мобильный. Возвращает номер в формате +7XXXXXXXXXX или null.
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const value = raw.trim();
  if (!value || !ALLOWED.test(value)) return null;

  const digits = value.replace(/\D/g, '');
  let local: string;

  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    local = digits.slice(1);
  } else if (digits.length === 10) {
    local = digits;
  } else {
    return null;
  }

  if (!/^7\d{9}$/.test(local)) return null;
  return `+7${local}`;
}
