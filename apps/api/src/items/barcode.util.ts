/** Encode cost price in last 5 digits (paise, max ₹999.99). */
export function encodeCostSuffix(costPrice: number): string {
  const paise = Math.round(Math.max(0, costPrice) * 100);
  return String(Math.min(paise, 99999)).padStart(5, '0');
}

/** Decode cost price from last 5 digits of a barcode. */
export function decodeCostFromBarcode(barcode: string): number | null {
  const digits = barcode.replace(/\D/g, '');
  if (digits.length < 5) return null;
  const paise = Number(digits.slice(-5));
  if (Number.isNaN(paise)) return null;
  return paise / 100;
}

/** Build 13-digit barcode: 8-digit prefix + 5-digit cost suffix. */
export function buildItemBarcode(
  seed: { sku: string; id: string },
  costPrice: number,
  existingPrefix?: string,
): string {
  let prefix = existingPrefix?.replace(/\D/g, '').slice(0, 8);
  if (!prefix || prefix.length < 8) {
    const base = seed.sku.replace(/\D/g, '') || seed.id.replace(/\D/g, '');
    prefix = (`890${base}`).replace(/\D/g, '').padEnd(8, '0').slice(0, 8);
  }
  return `${prefix}${encodeCostSuffix(costPrice)}`;
}
