/**
 * wa.me link that opens WhatsApp with a pre-filled message.
 * Indian 10-digit mobiles get the 91 country code added.
 */
export function waLink(phone: string | null | undefined, text: string) {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 11) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
