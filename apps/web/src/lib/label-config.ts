// Customizable barcode-label design. Persisted per-device in localStorage so the
// designer (Settings) and the print engine (print-tags) share one definition.
// Each field carries its own position (mm) on the label so users can MOVE the
// name/price/barcode/etc. anywhere (drag designer).

export type LabelField = 'name' | 'category' | 'size' | 'colour' | 'sku' | 'mrp' | 'price' | 'barcode' | 'barcodeNumber';

export interface FieldSpec {
  show: boolean;
  xMm: number;   // left offset within the label
  yMm: number;   // top offset within the label
  fontPt: number;
  bold: boolean;
}

export interface LabelConfig {
  fields: Record<LabelField, FieldSpec>;
  widthMm: number;
  heightMm: number;
  barcodeHeightMm: number; // rendered height of the barcode image
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
  widthMm: 50,
  heightMm: 25,
  barcodeHeightMm: 11,
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
    return {
      ...DEFAULT_LABEL_CONFIG,
      widthMm: typeof parsed.widthMm === 'number' ? parsed.widthMm : DEFAULT_LABEL_CONFIG.widthMm,
      heightMm: typeof parsed.heightMm === 'number' ? parsed.heightMm : DEFAULT_LABEL_CONFIG.heightMm,
      barcodeHeightMm: typeof parsed.barcodeHeightMm === 'number' ? parsed.barcodeHeightMm : DEFAULT_LABEL_CONFIG.barcodeHeightMm,
      fields,
    };
  } catch {
    return DEFAULT_LABEL_CONFIG;
  }
}

export function saveLabelConfig(config: LabelConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
