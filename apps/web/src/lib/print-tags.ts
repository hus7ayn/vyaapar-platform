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

// The text value for each configurable text field (barcode image handled separately).
export function labelFieldText(field: LabelField, t: TagSpec): string | null {
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

const TEXT_FIELDS: LabelField[] = ['name', 'category', 'size', 'colour', 'sku', 'mrp', 'price', 'barcodeNumber'];

/** Prints labels via the browser print dialog, each field absolutely positioned per the designer config. */
export function printBarcodeTags(tags: TagSpec[], config: LabelConfig = loadLabelConfig()) {
  const body = tags
    .map((t) => {
      const count = Math.max(1, Math.min(200, Math.floor(t.qty) || 1));

      const textEls = TEXT_FIELDS
        .filter((f) => config.fields[f]?.show)
        .map((f) => {
          const val = labelFieldText(f, t);
          if (!val) return '';
          const s = config.fields[f];
          return `<div class="fld" style="left:${s.xMm}mm;top:${s.yMm}mm;font-size:${s.fontPt}px;font-weight:${s.bold ? 700 : 400}">${escapeHtml(val)}</div>`;
        })
        .join('');

      const bc = config.fields.barcode;
      const barcodeEl = bc?.show
        ? `<img src="${t.dataUrl}" alt="${escapeHtml(t.barcode)}" style="left:${bc.xMm}mm;top:${bc.yMm}mm;height:${config.barcodeHeightMm}mm" />`
        : '';

      const tag = `<div class="tag">${textEls}${barcodeEl}</div>`;
      return tag.repeat(count);
    })
    .join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Tags</title>
<style>
  @page { size: ${config.widthMm}mm ${config.heightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
  .tag { position: relative; width: ${config.widthMm}mm; height: ${config.heightMm}mm; page-break-after: always; overflow: hidden; }
  .tag .fld { position: absolute; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.1; }
  .tag img { position: absolute; max-width: 100%; object-fit: contain; }
</style>
</head><body>${body}</body></html>`;

  printHtmlDocument(html);
}
