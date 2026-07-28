// Customizable barcode-label design. Persisted per-device in localStorage so the
// designer (Settings) and the print engine (print-tags) share one definition.
// Each field carries its own position (mm) on the label so users can MOVE the
// name/price/barcode/etc. anywhere (drag designer).

export type LabelField = 'name' | 'category' | 'size' | 'colour' | 'sku' | 'mrp' | 'price' | 'barcode' | 'barcodeNumber';

export type LabelAlign = 'left' | 'center' | 'right';

export interface FieldSpec {
  show: boolean;
  xMm: number;   // left offset within the label
  yMm: number;   // top offset within the label
  fontPt: number;
  bold: boolean;
  align?: LabelAlign;
}

// A user-added free-text element (add/remove your own labels, prices notes, shop name, etc.).
export interface CustomElement {
  id: string;
  text: string;
  xMm: number;
  yMm: number;
  fontPt: number;
  bold: boolean;
  align?: LabelAlign;
}

export interface LabelConfig {
  fields: Record<LabelField, FieldSpec>;
  custom: CustomElement[];
  widthMm: number;
  heightMm: number;
  barcodeHeightMm: number; // rendered height of the barcode image
  barcodeWidthMm?: number; // rendered width of the barcode image (0/undefined = auto)
  rotateDeg?: 0 | 90 | 180 | 270; // rotate the printed label to match the printer's feed direction
}

export const LABEL_FIELDS: LabelField[] = ['name', 'category', 'size', 'colour', 'sku', 'mrp', 'price', 'barcode', 'barcodeNumber'];

export const LABEL_FIELD_LABELS: Record<LabelField, string> = {
  name: 'Item Name',
  category: 'Category',
  size: 'Size',
  colour: 'Colour',
  sku: 'SKU / Item Code',
  mrp: 'MRP',
  price: 'Sale Price',
  barcode: 'Barcode',
  barcodeNumber: 'Barcode number',
};

// Thermal label paper presets (width × height in mm).
export const LABEL_PAPER_PRESETS: { label: string; widthMm: number; heightMm: number }[] = [
  { label: '50 × 25 mm', widthMm: 50, heightMm: 25 },
  { label: '40 × 30 mm', widthMm: 40, heightMm: 30 },
  { label: '38 × 25 mm', widthMm: 38, heightMm: 25 },
  { label: '65 × 35 mm', widthMm: 65, heightMm: 35 },
  { label: '100 × 50 mm', widthMm: 100, heightMm: 50 },
];

const F = (show: boolean, xMm: number, yMm: number, fontPt: number, bold: boolean): FieldSpec => ({ show, xMm, yMm, fontPt, bold });

// Default reproduces the classic tag (Name + Sale Price + barcode) laid out on a 50×25 label.
export const DEFAULT_LABEL_CONFIG: LabelConfig = {
  fields: {
    name: F(true, 2, 1.5, 8, true),
    category: F(false, 2, 5, 7, false),
    size: F(false, 34, 1.5, 7, false),
    colour: F(false, 34, 5, 7, false),
    sku: F(false, 2, 5, 7, false),
    mrp: F(false, 30, 6, 9, true),
    price: F(true, 2, 6, 10, true),
    barcode: F(true, 2, 10.5, 8, false),
    barcodeNumber: F(false, 2, 22, 6, false),
  },
  custom: [],
  widthMm: 50,
  heightMm: 25,
  barcodeHeightMm: 11,
  barcodeWidthMm: 0,
  rotateDeg: 0,
};

const STORAGE_KEY = 'msw-label-config';

// Accepts a boolean (legacy config) or a partial FieldSpec and returns a full FieldSpec.
function normalizeField(fallback: FieldSpec, value: unknown): FieldSpec {
  if (typeof value === 'boolean') return { ...fallback, show: value };
  if (value && typeof value === 'object') return { ...fallback, ...(value as Partial<FieldSpec>) };
  return fallback;
}

export function loadLabelConfig(): LabelConfig {
  if (typeof window === 'undefined') return DEFAULT_LABEL_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LABEL_CONFIG;
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>> & { fields?: Record<string, unknown> };
    const fields = {} as Record<LabelField, FieldSpec>;
    for (const f of LABEL_FIELDS) {
      fields[f] = normalizeField(DEFAULT_LABEL_CONFIG.fields[f], parsed.fields?.[f]);
    }
    const custom = Array.isArray(parsed.custom)
      ? (parsed.custom as unknown[])
          .filter((c): c is Partial<CustomElement> => !!c && typeof c === 'object' && 'text' in (c as object))
          .map((c, i): CustomElement => ({
            id: typeof c.id === 'string' ? c.id : `c${i}`,
            text: typeof c.text === 'string' ? c.text : '',
            xMm: typeof c.xMm === 'number' ? c.xMm : 2,
            yMm: typeof c.yMm === 'number' ? c.yMm : 2,
            fontPt: typeof c.fontPt === 'number' ? c.fontPt : 8,
            bold: !!c.bold,
            align: c.align ?? 'left',
          }))
      : [];
    // typeof NaN === 'number' (and 0/negatives) would otherwise slip through and emit an invalid
    // @page size, making the browser fall back to a full A4 sheet that the driver scales+rotates.
    const posNum = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : f);
    const nonNegNum = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : f);
    return {
      ...DEFAULT_LABEL_CONFIG,
      widthMm: posNum(parsed.widthMm, DEFAULT_LABEL_CONFIG.widthMm),
      heightMm: posNum(parsed.heightMm, DEFAULT_LABEL_CONFIG.heightMm),
      barcodeHeightMm: posNum(parsed.barcodeHeightMm, DEFAULT_LABEL_CONFIG.barcodeHeightMm),
      barcodeWidthMm: nonNegNum(parsed.barcodeWidthMm, DEFAULT_LABEL_CONFIG.barcodeWidthMm ?? 0),
      rotateDeg: [90, 180, 270].includes(parsed.rotateDeg as number) ? (parsed.rotateDeg as 90 | 180 | 270) : 0,
      fields,
      custom,
    };
  } catch {
    return DEFAULT_LABEL_CONFIG;
  }
}

export function saveLabelConfig(config: LabelConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
