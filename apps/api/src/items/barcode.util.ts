// Item barcodes are Code 128 symbols (see ItemsService.generateBarcodePng), which — unlike
// EAN-13 — carry a VARIABLE number of digits. The value is laid out as an 8-digit identity
// prefix followed by the cost price in paise:
//
//   8 9 0 1 2 3 4 5 | 0 4 9 9 0        ₹49.90   (13 digits, the classic tag)
//   8 9 0 1 2 3 4 5 | 1 2 5 0 0 5 0    ₹12500.50 (15 digits)
//
// The suffix is padded to a MINIMUM of 5 digits, so anything under ₹1000 still produces the
// same 13-digit code as before and every label already printed keeps decoding correctly.
// Dearer items simply grow the suffix instead of being clamped — the old code capped it at
// 99999 paise, which silently printed ₹999.99 on every item costing ₹1000 or more.

/** Digits of identity that precede the cost suffix. Fixed, so the decoder knows where cost starts. */
export const BARCODE_PREFIX_LEN = 8;

/** Minimum cost-suffix width; keeps sub-₹1000 items on the historical 13-digit layout. */
const MIN_COST_SUFFIX_LEN = 5;

/** Encode cost price as paise. At least 5 digits, widening as needed for ₹1000 and above. */
export function encodeCostSuffix(costPrice: number): string {
  const paise = Math.round(Math.max(0, costPrice) * 100);
  return String(Number.isFinite(paise) ? paise : 0).padStart(MIN_COST_SUFFIX_LEN, '0');
}

/** Decode cost price from everything after the 8-digit prefix (paise → rupees). */
export function decodeCostFromBarcode(barcode: string): number | null {
  const digits = barcode.replace(/\D/g, '');
  // A shorter value carries no cost field at all. For the legacy 13-digit codes slice(8) is the
  // same five digits the old slice(-5) read, so nothing already in circulation changes meaning.
  if (digits.length <= BARCODE_PREFIX_LEN) return null;
  const paise = Number(digits.slice(BARCODE_PREFIX_LEN));
  if (!Number.isFinite(paise)) return null;
  return paise / 100;
}

/** Build the barcode: 8-digit prefix + cost suffix (5 digits, or more for ₹1000+). */
export function buildItemBarcode(
  seed: { sku: string; id: string },
  costPrice: number,
  existingPrefix?: string,
): string {
  let prefix = existingPrefix?.replace(/\D/g, '').slice(0, BARCODE_PREFIX_LEN);
  if (!prefix || prefix.length < BARCODE_PREFIX_LEN) {
    const base = seed.sku.replace(/\D/g, '') || seed.id.replace(/\D/g, '');
    prefix = (`890${base}`).replace(/\D/g, '').padEnd(BARCODE_PREFIX_LEN, '0').slice(0, BARCODE_PREFIX_LEN);
  }
  return `${prefix}${encodeCostSuffix(costPrice)}`;
}
