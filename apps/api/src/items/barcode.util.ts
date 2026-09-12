// Item barcodes are Code 128 symbols (see ItemsService.generateBarcodePng), which — unlike
// EAN-13 — carry a VARIABLE number of digits. The value is laid out as an 8-digit identity
// prefix followed by the cost price in WHOLE RUPEES:
//
//   8 9 0 1 2 3 4 5 | 0 0 0 5 0        ₹50      (13 digits)
//   8 9 0 1 2 3 4 5 | 2 5 0 0 0        ₹25,000  (13 digits)
//
// The suffix is 5 digits, which covers every cost up to ₹99,999 — so in practice every tag is
// exactly 13 digits. RUPEES, not paise: the counter reads the cost straight off the label, and a
// trailing "00" for the paise on every single code was pure noise. A cost above ₹99,999 widens
// the suffix rather than being clamped (the old encoder clamped at ₹999.99, which silently
// printed the wrong cost on every item over ₹1000).
//
// Paise are deliberately NOT carried — ₹1,499.59 reads as 01500. These digits are a cost
// REFERENCE for the counter; the exact cost always lives in the item record. Compare with
// barcodeCostMatches(), never with raw equality against a paise figure.
//
// A barcode is PRINTED and stuck on physical stock, so the value is treated as immutable once
// assigned: only an explicit Regenerate (ItemsService.assignBarcode) may change it. Nothing here
// rewrites a stored barcode as a side effect of an edit.

/** Digits of identity that precede the cost suffix. Fixed, so the decoder knows where cost starts. */
export const BARCODE_PREFIX_LEN = 8;

/** Minimum cost-suffix width; keeps sub-₹1000 items on the historical 13-digit layout. */
const MIN_COST_SUFFIX_LEN = 5;

/** The house head every generated prefix starts with; the rest of the prefix is item identity. */
const HOUSE_HEAD = '890';
/** Identity digits inside the prefix (8 - 3 = 5) and how many distinct values they hold. */
const IDENTITY_LEN = BARCODE_PREFIX_LEN - HOUSE_HEAD.length;
const IDENTITY_SPACE = 10 ** IDENTITY_LEN;

/** Encode cost price as WHOLE RUPEES — 5 digits, widening only past ₹99,999. */
export function encodeCostSuffix(costPrice: number): string {
  const rupees = Math.round(Math.max(0, costPrice));
  return String(Number.isFinite(rupees) ? rupees : 0).padStart(MIN_COST_SUFFIX_LEN, '0');
}

/** Decode the cost price (whole rupees) from everything after the 8-digit prefix. */
export function decodeCostFromBarcode(barcode: string): number | null {
  const digits = barcode.replace(/\D/g, '');
  if (digits.length <= BARCODE_PREFIX_LEN) return null;
  const rupees = Number(digits.slice(BARCODE_PREFIX_LEN));
  if (!Number.isFinite(rupees)) return null;
  return rupees;
}

/**
 * Does this barcode's cost field agree with the item's cost price?
 *
 * Compared at RUPEE granularity, because rupees is all the suffix carries: ₹1,499.59 encodes as
 * 01500, and a raw paise comparison would report that perfectly good tag as stale and send the
 * shop off to reprint a label that is already correct.
 */
export function barcodeCostMatches(barcode: string, costPrice: number): boolean {
  const decoded = decodeCostFromBarcode(barcode);
  if (decoded == null) return false;
  return decoded === Math.round(Math.max(0, Number.isFinite(costPrice) ? costPrice : 0));
}

/** ₹999.99 in paise — the ceiling the old encoder clamped every cost to (see the note above). */
const CLAMPED_COST_PAISE = 99999;

/** What the prefix becomes when an item's sku AND id contain no digits at all. */
const DIGITLESS_PREFIX = HOUSE_HEAD.padEnd(BARCODE_PREFIX_LEN, '0');

/** Prefix derivation for an item with no barcode to inherit one from. Null when the seed has no digits. */
export function deriveBarcodePrefix(seed: string | null | undefined): string | null {
  const base = (seed ?? '').replace(/\D/g, '');
  if (!base) return null;
  return `${HOUSE_HEAD}${base}`.padEnd(BARCODE_PREFIX_LEN, '0').slice(0, BARCODE_PREFIX_LEN);
}

/** The 8-digit identity an item keeps: the one already printed on its tags, else a derived one. */
export function resolveBarcodePrefix(
  seed: { sku?: string | null; id?: string | null },
  existingPrefix?: string | null,
): string {
  const kept = existingPrefix?.replace(/\D/g, '').slice(0, BARCODE_PREFIX_LEN);
  if (kept && kept.length === BARCODE_PREFIX_LEN) return kept;
  return deriveBarcodePrefix(seed.sku) ?? deriveBarcodePrefix(seed.id) ?? DIGITLESS_PREFIX;
}

/**
 * A DIFFERENT 8-digit prefix, for breaking a barcode collision.
 *
 * The old retry appended to the sku (`${sku}${attempt}`) and re-derived, but deriveBarcodePrefix
 * only ever reads the FIRST five digits of the seed — so for any sku with five or more digits
 * every retry rebuilt the byte-identical candidate and the clash was never broken. Two items
 * could then be stored under one barcode, and findByBarcode (exact match, findFirst) would ring
 * up whichever row came back first: the wrong item, at the wrong price, off the wrong stock.
 *
 * Walking the identity digits instead is guaranteed to move: `attempt` values 1..N give N
 * distinct prefixes (N ≪ IDENTITY_SPACE), all still under the house head.
 */
export function perturbBarcodePrefix(prefix: string, attempt: number): string {
  const digits = prefix.replace(/\D/g, '').padEnd(BARCODE_PREFIX_LEN, '0').slice(0, BARCODE_PREFIX_LEN);
  const head = digits.slice(0, HOUSE_HEAD.length);
  const identity = Number(digits.slice(HOUSE_HEAD.length)) || 0;
  const step = Math.trunc(attempt) % IDENTITY_SPACE;
  const moved = ((identity + step) % IDENTITY_SPACE + IDENTITY_SPACE) % IDENTITY_SPACE;
  return `${head}${String(moved).padStart(IDENTITY_LEN, '0')}`;
}

/** Build the barcode: 8-digit prefix + cost suffix (5 digits, or more for ₹1000+). */
export function buildItemBarcode(
  seed: { sku: string; id: string },
  costPrice: number,
  existingPrefix?: string,
): string {
  return `${resolveBarcodePrefix(seed, existingPrefix)}${encodeCostSuffix(costPrice)}`;
}

/**
 * Standard GTIN self-check (EAN-13, UPC-A/12, EAN-8). Weights 3,1,3,1… from the right of the
 * body; the last digit must be the value that brings the weighted sum to a multiple of ten.
 */
function gtinCheckDigit(body: string): number {
  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Does this value carry a valid retail check digit — i.e. is it a symbol a manufacturer printed?
 *
 * Only the lengths actually printed on consumer retail packs are tested (EAN-8, UPC-A, EAN-13).
 * Our own 13-digit codes put a cost in those digits, so only about one in ten of them satisfies
 * the check by accident; our ₹1000+ codes are 14 digits or longer and are never tested at all.
 */
function hasRetailCheckDigit(digits: string): boolean {
  if (digits.length !== 13 && digits.length !== 12 && digits.length !== 8) return false;
  return gtinCheckDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}

/** Could this 8-digit prefix be one this generator produced for THIS item? */
function isOwnPrefix(prefix: string, seed: { sku?: string | null; id?: string | null }): boolean {
  const fromSku = deriveBarcodePrefix(seed.sku);
  if (fromSku && prefix === fromSku) return true;
  // Reachable for items whose barcode was built with the real row id (bulkGenerateBarcodes, and
  // update() filling in a missing barcode) rather than at create() time.
  const fromId = deriveBarcodePrefix(seed.id);
  if (fromId && prefix === fromId) return true;
  // create() seeds BOTH fields with the sku (the row id does not exist yet), so a digit-free sku
  // — 'SOAP', or the auto `ITM-${base36}` when it lands without digits — is stored under
  // DIGITLESS_PREFIX. Claim that only for an item whose own sku really has no digits, otherwise
  // '89000000' would be claimed by every item in the shop.
  return !fromSku && prefix === DIGITLESS_PREFIX;
}

/**
 * Do this barcode's trailing digits actually hold a cost price?
 *
 * Only values this generator produced do. Seeded, hand-entered and manufacturer barcodes are
 * plain numbers — slicing digits off them yields a meaningless “cost” (the seeded 8901001003001
 * on a ₹168 item decodes to ₹30.01), and acting on that — warning the owner their tag is stale —
 * pushes them to regenerate a barcode already printed on physical stock, which then stops
 * scanning. Nothing downstream prices anything off this (the decoded figure is shown, never
 * charged), so a missed warning costs nothing while a false one costs a shelf of labels: when in
 * doubt, say no.
 *
 * Accepted signatures, narrowest first:
 *
 *   1. the clamp signature — a 13-digit code whose cost digits are exactly 99999 (₹999.99) on an
 *      item costing more than that, which is what the pre-fix encoder printed for every ₹1000+
 *      item and is the actual bug the shop hit;
 *   2. the 8-digit prefix is one this generator derives for THIS item (sku, row id, or the
 *      digitless fallback) — and the value is not itself a valid retail symbol, and its suffix
 *      has the shape our encoder emits.
 *
 * An item that inherited its prefix from an imported barcode falls outside both and stays
 * unflagged on purpose.
 */
export function isCostEncodedBarcode(
  barcode: string | null | undefined,
  seed: { sku?: string | null; id?: string | null },
  costPrice: number,
): boolean {
  const digits = (barcode ?? '').replace(/\D/g, '');
  if (digits.length <= BARCODE_PREFIX_LEN) return false;
  const suffix = digits.slice(BARCODE_PREFIX_LEN);
  const costPaise = Math.round(Math.max(0, Number.isFinite(costPrice) ? costPrice : 0) * 100);

  // (1) The clamp signature stands on its own: it is specific enough (exactly 13 digits, exactly
  // 99999 paise, on an item that costs more) that no check-digit test should suppress it.
  if (
    digits.length === BARCODE_PREFIX_LEN + MIN_COST_SUFFIX_LEN &&
    Number(suffix) === CLAMPED_COST_PAISE &&
    costPaise > CLAMPED_COST_PAISE
  ) {
    return true;
  }

  // (2a) Our encoder pads the suffix to five digits and then widens — String(paise) never gains a
  // leading zero — so a longer suffix that starts with one was printed by somebody else.
  if (suffix.length > MIN_COST_SUFFIX_LEN && suffix.startsWith('0')) return false;
  // (2b) A value that satisfies its own GS1 check digit is a real printed retail symbol. Every
  // EAN/UPC on a pack does; ours only by coincidence. Never claim one — the whole point of this
  // test is to keep the app from talking a shop into reprinting a manufacturer's label.
  if (hasRetailCheckDigit(digits)) return false;
  // (2c) …and the identity digits have to be ones we would have written for this very item.
  return isOwnPrefix(digits.slice(0, BARCODE_PREFIX_LEN), seed);
}
