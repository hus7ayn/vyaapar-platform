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

/** ₹999.99 in paise — the ceiling the old encoder clamped every cost to (see the note above). */
const CLAMPED_COST_PAISE = 99999;

/** What the prefix becomes when an item's sku AND id contain no digits at all. */
const DIGITLESS_PREFIX = '890'.padEnd(BARCODE_PREFIX_LEN, '0');

/** Prefix derivation for an item with no barcode to inherit one from. Null when the seed has no digits. */
export function deriveBarcodePrefix(seed: string | null | undefined): string | null {
  const base = (seed ?? '').replace(/\D/g, '');
  if (!base) return null;
  return `890${base}`.padEnd(BARCODE_PREFIX_LEN, '0').slice(0, BARCODE_PREFIX_LEN);
}

/** Build the barcode: 8-digit prefix + cost suffix (5 digits, or more for ₹1000+). */
export function buildItemBarcode(
  seed: { sku: string; id: string },
  costPrice: number,
  existingPrefix?: string,
): string {
  let prefix = existingPrefix?.replace(/\D/g, '').slice(0, BARCODE_PREFIX_LEN);
  if (!prefix || prefix.length < BARCODE_PREFIX_LEN) {
    prefix = deriveBarcodePrefix(seed.sku) ?? deriveBarcodePrefix(seed.id) ?? DIGITLESS_PREFIX;
  }
  return `${prefix}${encodeCostSuffix(costPrice)}`;
}

/**
 * Do this barcode's trailing digits actually hold a cost price?
 *
 * Only values this generator produced do. Seeded, CSV-imported and hand-typed barcodes are plain
 * numbers — slicing digits off them yields a meaningless “cost” (the seeded 8901001003001 on a
 * ₹168 item decodes to ₹30.01), and acting on that — warning the owner their tag is stale —
 * pushes them to regenerate a barcode already printed on physical stock, which then stops
 * scanning. So only two signatures count, and effectively only ours can carry either:
 *
 *   1. the 8-digit prefix is the one this generator derives from THIS item's sku (or id), or
 *   2. the clamp signature — a 13-digit code whose cost digits are exactly 99999 (₹999.99) on an
 *      item costing more than that, which is what the pre-fix encoder printed for every ₹1000+
 *      item and is the actual bug the shop hit.
 *
 * An item that inherited its prefix from an imported barcode falls outside (1) and stays unflagged
 * on purpose: a missed warning is far cheaper than telling a shop to invalidate a printed label.
 */
export function isCostEncodedBarcode(
  barcode: string | null | undefined,
  seed: { sku?: string | null; id?: string | null },
  costPrice: number,
): boolean {
  const digits = (barcode ?? '').replace(/\D/g, '');
  if (digits.length <= BARCODE_PREFIX_LEN) return false;
  const prefix = digits.slice(0, BARCODE_PREFIX_LEN);
  if (prefix === deriveBarcodePrefix(seed.sku) || prefix === deriveBarcodePrefix(seed.id)) return true;
  const costPaise = Math.round(Math.max(0, Number.isFinite(costPrice) ? costPrice : 0) * 100);
  return (
    digits.length === BARCODE_PREFIX_LEN + MIN_COST_SUFFIX_LEN &&
    Number(digits.slice(BARCODE_PREFIX_LEN)) === CLAMPED_COST_PAISE &&
    costPaise > CLAMPED_COST_PAISE
  );
}
