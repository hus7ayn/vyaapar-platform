import { printHtmlDocument } from '@/lib/print-html';
import { LabelConfig, LabelField, loadLabelConfig } from '@/lib/label-config';

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface TagSpec {
  dataUrl: string;
  barcode: string;
  name: string;
  price: number;
  qty: number;
  // Optional extra fields the label designer can show.
  category?: string | null;
  sku?: string | null;
  mrp?: number | null;
  size?: string | null;
  colour?: string | null;
}

// The text value for each configurable field (barcode image is always drawn).
function fieldValue(field: LabelField, t: TagSpec): string | null {
  switch (field) {
    case 'name': return t.name;
    case 'category': return t.category ?? null;
    case 'size': return t.size ?? null;
    case 'colour': return t.colour ?? null;
    case 'sku': return t.sku ?? null;
    case 'mrp': return t.mrp != null ? `MRP ₹${t.mrp.toFixed(2)}` : null;
    case 'price': return `₹${t.price.toFixed(2)}`;
    case 'barcodeNumber': return t.barcode;
    default: return null;
  }
}

const FIELD_ORDER: LabelField[] = ['name', 'category', 'size', 'colour', 'sku', 'mrp', 'price'];

/** Prints labels via the browser print dialog, laid out per the label designer config. */
export function printBarcodeTags(tags: TagSpec[], config: LabelConfig = loadLabelConfig()) {
  const emphasised = new Set<LabelField>(['name', 'mrp', 'price']);

  const body = tags
    .map((t) => {
      const count = Math.max(1, Math.min(200, Math.floor(t.qty) || 1));
      const rows = FIELD_ORDER
        .filter((f) => config.fields[f])
        .map((f) => {
          const val = fieldValue(f, t);
          if (!val) return '';
          return `<div class="line${emphasised.has(f) ? ' strong' : ''}">${escapeHtml(val)}</div>`;
        })
        .join('');
      const barcodeNum = config.fields.barcodeNumber
        ? `<div class="line bcnum">${escapeHtml(t.barcode)}</div>`
        : '';
      const tag = `
    <div class="tag">
      ${rows}
      <img src="${t.dataUrl}" alt="${escapeHtml(t.barcode)}" />
      ${barcodeNum}
    </div>`;
      return tag.repeat(count);
    })
    .join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Tags</title>
<style>
  @page { size: ${config.widthMm}mm ${config.heightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
  .tag {
    width: ${config.widthMm}mm; height: ${config.heightMm}mm; padding: ${config.marginMm}mm;
    display: flex; flex-direction: column; align-items: ${config.align === 'left' ? 'flex-start' : config.align === 'right' ? 'flex-end' : 'center'}; justify-content: center;
    page-break-after: always; text-align: ${config.align}; overflow: hidden;
  }
  .tag .line { font-size: ${config.fontPt}px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.15; }
  .tag .line.strong { font-weight: 700; }
  .tag .bcnum { font-size: ${Math.max(6, config.fontPt - 2)}px; letter-spacing: 0.5px; }
  .tag img { max-width: 100%; height: ${config.barcodeHeightMm}mm; object-fit: contain; margin: 0.5mm 0; }
</style>
</head><body>${body}</body></html>`;

  printHtmlDocument(html);
}
