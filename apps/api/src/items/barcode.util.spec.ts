import {
  BARCODE_PREFIX_LEN,
  buildItemBarcode,
  barcodeCostMatches,
  decodeCostFromBarcode,
  deriveBarcodePrefix,
  encodeCostSuffix,
  isCostEncodedBarcode,
  perturbBarcodePrefix,
  resolveBarcodePrefix,
} from './barcode.util';

/** Append the standard GS1 check digit, so these read as symbols a manufacturer really printed. */
function withCheckDigit(body: string): string {
  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

describe('barcode cost encoding', () => {
  it('round-trips to the rupee, including past the old ₹999.99 clamp', () => {
    for (const rupees of [0, 0.05, 49.9, 168, 999.99, 1000, 1234.5, 12500.5, 25000, 99999]) {
      const barcode = buildItemBarcode({ sku: 'PRD-123', id: 'PRD-123' }, rupees);
      expect(barcode.slice(0, BARCODE_PREFIX_LEN)).toHaveLength(BARCODE_PREFIX_LEN);
      expect(decodeCostFromBarcode(barcode)).toBe(Math.round(rupees));
      expect(barcodeCostMatches(barcode, rupees)).toBe(true);
    }
  });

  it('puts every ordinary cost on a 13-digit tag, with no trailing paise zeros', () => {
    expect(buildItemBarcode({ sku: 'PRD-123', id: 'PRD-123' }, 49.9)).toHaveLength(13);
    expect(encodeCostSuffix(49.9)).toBe('00050');
    // The complaint that drove this: ₹25,000 used to end 2500000 — "25000" plus two paise zeros.
    expect(encodeCostSuffix(25000)).toBe('25000');
    expect(buildItemBarcode({ sku: 'PRD-123', id: 'PRD-123' }, 25000)).toHaveLength(13);
  });

  it('does not call a tag stale just because the cost carries paise', () => {
    const barcode = buildItemBarcode({ sku: 'PRD-123', id: 'PRD-123' }, 1499.59);
    expect(encodeCostSuffix(1499.59)).toBe('01500');
    expect(barcodeCostMatches(barcode, 1499.59)).toBe(true);
    expect(barcodeCostMatches(barcode, 1600)).toBe(false);
  });
});

describe('collision retries', () => {
  // The old retry re-derived from `${sku}${attempt}`; deriveBarcodePrefix reads only the first
  // five digits of the seed, so every attempt rebuilt the identical candidate and two items could
  // be stored under one barcode.
  it('gives a distinct candidate for every attempt', () => {
    const prefix = resolveBarcodePrefix({ sku: 'PRD-100002', id: 'PRD-100002' });
    const suffix = encodeCostSuffix(50);
    const seen = new Set<string>([`${prefix}${suffix}`]);
    for (let attempt = 1; attempt < 25; attempt++) seen.add(`${perturbBarcodePrefix(prefix, attempt)}${suffix}`);
    expect(seen.size).toBe(25);
  });

  it('cannot land back on the colliding sibling of a 6-digit sku', () => {
    const taken = buildItemBarcode({ sku: 'PRD-100001', id: 'PRD-100001' }, 50);
    const mine = resolveBarcodePrefix({ sku: 'PRD-100002', id: 'PRD-100002' });
    expect(`${mine}${encodeCostSuffix(50)}`).toBe(taken); // same derived identity — the clash
    for (let attempt = 1; attempt < 25; attempt++) {
      expect(`${perturbBarcodePrefix(mine, attempt)}${encodeCostSuffix(50)}`).not.toBe(taken);
    }
  });

  it('stays an 8-digit house code and wraps instead of overflowing', () => {
    expect(perturbBarcodePrefix('89099999', 1)).toBe('89000000');
    expect(perturbBarcodePrefix('89010000', 7)).toBe('89010007');
    expect(perturbBarcodePrefix('89010000', 3)).toHaveLength(BARCODE_PREFIX_LEN);
  });
});

describe('isCostEncodedBarcode', () => {
  it('never claims a manufacturer symbol that satisfies its own check digit', () => {
    for (const body of ['890100100300', '890103051189', '890600209000', '890123400123']) {
      const ean = withCheckDigit(body);
      const sku = ean.slice(3, 8); // the sku whose derived prefix matches these digits
      expect(isCostEncodedBarcode(ean, { sku, id: 'row-uuid-9f' }, 168)).toBe(false);
    }
  });

  it('rejects a longer value whose suffix is zero-padded — ours never is', () => {
    expect(isCostEncodedBarcode('89010010012345', { sku: '1001', id: 'row' }, 168)).toBe(false);
  });

  it('still recognises a barcode this generator produced once the cost has drifted', () => {
    const mine = buildItemBarcode({ sku: 'PRD-100001', id: 'PRD-100001' }, 168);
    expect(isCostEncodedBarcode(mine, { sku: 'PRD-100001', id: 'row-uuid' }, 170)).toBe(true);
  });

  it('recognises the digitless-sku barcode create() actually stores', () => {
    // create() seeds both sku and id with the sku, so 'SOAP' lands on the digitless prefix.
    const generated = buildItemBarcode({ sku: 'SOAP', id: 'SOAP' }, 25);
    expect(generated.startsWith('89000000')).toBe(true);
    expect(isCostEncodedBarcode(generated, { sku: 'SOAP', id: 'row-uuid' }, 30)).toBe(true);
    // …but that prefix is not up for grabs by an item whose sku does have digits.
    expect(isCostEncodedBarcode(generated, { sku: 'PRD-9', id: 'row-uuid' }, 30)).toBe(false);
  });

  it('recognises an id-seeded barcode (bulk generate / fill-in)', () => {
    const generated = buildItemBarcode({ sku: 'SOAP', id: 'a1b2c3d4-5566' }, 25);
    expect(isCostEncodedBarcode(generated, { sku: 'SOAP', id: 'a1b2c3d4-5566' }, 30)).toBe(true);
  });

  it('still flags the ₹999.99 clamp signature, which is the bug the shop hit', () => {
    expect(isCostEncodedBarcode('8901000099999', { sku: 'PRD-100001', id: 'row' }, 1500)).toBe(true);
  });

  it('says nothing about a value with no cost field at all', () => {
    expect(isCostEncodedBarcode('89010010', { sku: '1001', id: 'row' }, 168)).toBe(false);
    expect(isCostEncodedBarcode(null, { sku: '1001', id: 'row' }, 168)).toBe(false);
  });

  it('keeps the legacy prefix derivation intact, so existing tags stay recognised', () => {
    expect(deriveBarcodePrefix('RST-001')).toBe('89000100');
    expect(deriveBarcodePrefix('SOAP')).toBeNull();
  });
});
