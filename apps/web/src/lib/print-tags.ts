import { printHtmlDocument } from '@/lib/print-html';

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface TagSpec {
  dataUrl: string;
  barcode: string;
  name: string;
  price: number;
  qty: number;
}

/** Prints one 50mm x 25mm label per tag (repeated `qty` times each) via the browser print dialog. */
export function printBarcodeTags(tags: TagSpec[]) {
  const body = tags
    .map((t) => {
      const count = Math.max(1, Math.min(200, Math.floor(t.qty) || 1));
      const tag = `
    <div class="tag">
      <div class="tag-name">${escapeHtml(t.name)}</div>
      <div class="tag-price">Rs. ${t.price.toFixed(2)}</div>
      <img src="${t.dataUrl}" alt="${escapeHtml(t.barcode)}" />
    </div>`;
      return tag.repeat(count);
    })
    .join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Tags</title>
<style>
  @page { size: 50mm 25mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
  .tag {
    width: 50mm; height: 25mm; padding: 1.5mm 2mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    page-break-after: always; text-align: center; overflow: hidden;
  }
  .tag-name { font-size: 8px; font-weight: 700; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tag-price { font-size: 10px; font-weight: 700; margin: 1px 0; }
  .tag img { max-width: 100%; height: 12mm; object-fit: contain; }
</style>
</head><body>${body}</body></html>`;

  printHtmlDocument(html);
}
