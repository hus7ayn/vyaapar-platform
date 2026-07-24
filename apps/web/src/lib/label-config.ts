// Customizable barcode-label design. Persisted per-device in localStorage so the
// designer (Settings) and the print engine (print-tags) share one definition.

export type LabelField = 'name' | 'category' | 'size' | 'colour' | 'sku' | 'mrp' | 'price' | 'barcodeNumber';

export interface LabelConfig {
  fields: Record<LabelField, boolean>;
  widthMm: number;
  heightMm: number;
  marginMm: number;
  fontPt: number;
  barcodeHeightMm: number;
  align: 'left' | 'center' | 'right';
}

export const LABEL_FIELD_LABELS: Record<LabelField, string> = {
  name: 'Item Name',
  category: 'Category',
  size: 'Size',
  colour: 'Colour',
  sku: 'SKU / Item Code',
  mrp: 'MRP',
  price: 'Sale Price',
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

// Default preserves the previous label: Item Name + Sale Price + barcode, 50×25mm.
export const DEFAULT_LABEL_CONFIG: LabelConfig = {
  fields: { name: true, category: false, size: false, colour: false, sku: false, mrp: false, price: true, barcodeNumber: false },
  widthMm: 50,
  heightMm: 25,
  marginMm: 1.5,
  fontPt: 8,
  barcodeHeightMm: 12,
  align: 'center',
};

const STORAGE_KEY = 'msw-label-config';

export function loadLabelConfig(): LabelConfig {
  if (typeof window === 'undefined') return DEFAULT_LABEL_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LABEL_CONFIG;
    const parsed = JSON.parse(raw) as Partial<LabelConfig>;
    return {
      ...DEFAULT_LABEL_CONFIG,
      ...parsed,
      fields: { ...DEFAULT_LABEL_CONFIG.fields, ...(parsed.fields ?? {}) },
    };
  } catch {
    return DEFAULT_LABEL_CONFIG;
  }
}

export function saveLabelConfig(config: LabelConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
