/**
 * Contact phone helpers (2026-10-13). Mirrors normalizePhoneNumber in
 * @smartify/validation (the backend re-validates every number) so the form
 * can show an error before calling the API.
 */
export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const ascii = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim();
  if (!/^[+\d\s().-]{8,25}$/.test(ascii)) return null;
  const international = ascii.startsWith("+") || ascii.startsWith("00");
  const digits = ascii.replace(/\D/g, "").replace(/^00/, "");
  const egypt = digits.match(/^(?:20)?0?(1[0125]\d{8})$/);
  if (egypt && (!international || digits.startsWith("20"))) return `+20${egypt[1]}`;
  if (international && !digits.startsWith("20") && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}

/** "+201012345678" → "01012345678" for display; other countries stay international. */
export function displayPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.startsWith("+20") ? `0${phone.slice(3)}` : phone;
}

/** wa.me link for a stored E.164 number. */
export function whatsappUrl(phone: string, text?: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
