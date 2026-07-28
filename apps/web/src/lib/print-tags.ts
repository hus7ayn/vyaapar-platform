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
          return `<div class="fld" style="left:${s.xMm}mm;top:${s.yMm}mm;font-size:${s.fontPt}px;font-weight:${s.bold ? 700 : 400};text-align:${s.align ?? 'left'}">${escapeHtml(val)}</div>`;
        })
        .join('');

      // User-added free-text elements.
      const customEls = (config.custom ?? [])
        .filter((el) => (el.text ?? '').trim())
        .map((el) => `<div class="fld" style="left:${el.xMm}mm;top:${el.yMm}mm;font-size:${el.fontPt}px;font-weight:${el.bold ? 700 : 400};text-align:${el.align ?? 'left'}">${escapeHtml(el.text)}</div>`)
        .join('');

      const bc = config.fields.barcode;
      const bw = config.barcodeWidthMm && config.barcodeWidthMm > 0 ? `width:${config.barcodeWidthMm}mm;` : '';
      const barcodeEl = bc?.show
        ? `<img src="${t.dataUrl}" alt="${escapeHtml(t.barcode)}" style="left:${bc.xMm}mm;top:${bc.yMm}mm;height:${config.barcodeHeightMm}mm;${bw}" />`
        : '';

      const tag = `<div class="page"><div class="tag">${textEls}${customEls}${barcodeEl}</div></div>`;
      return tag.repeat(count);
    })
    .join('');

  // Optional rotation so a landscape (50x25) design can print onto a portrait-fed roll (or
  // vice-versa) without touching the driver. For 90/270 the physical page is the swapped size
  // and the designed label is rotated + centered into it.
  const rot = [90, 180, 270].includes(config.rotateDeg as number) ? (config.rotateDeg as number) : 0;
  const swap = rot === 90 || rot === 270;
  const pageW = swap ? config.heightMm : config.widthMm;
  const pageH = swap ? config.widthMm : config.heightMm;
  const rotStyle = rot ? `transform: translate(-50%, -50%) rotate(${rot}deg); position: absolute; left: 50%; top: 50%;` : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Tags</title>
<style>
  @page { size: ${pageW}mm ${pageH}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
  .page { position: relative; width: ${pageW}mm; height: ${pageH}mm; page-break-after: always; overflow: hidden; }
  .tag { position: relative; width: ${config.widthMm}mm; height: ${config.heightMm}mm; overflow: hidden; ${rotStyle} }
  .tag .fld { position: absolute; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.1; writing-mode: horizontal-tb; text-orientation: mixed; direction: ltr; }
  .tag img { position: absolute; max-width: 100%; object-fit: contain; }
</style>
</head><body>${body}</body></html>`;

  printHtmlDocument(html);
}
