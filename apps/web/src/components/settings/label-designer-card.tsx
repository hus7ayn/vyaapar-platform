'use client';

import { useEffect, useRef, useState } from 'react';
import { Barcode, Plus, Trash2, AlignLeft, AlignCenter, AlignRight, ZoomIn } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { printBarcodeTags, TagSpec } from '@/lib/print-tags';
import { useAuthStore } from '@/stores/auth-store';
import {
  DEFAULT_LABEL_CONFIG,
  LABEL_FIELDS,
  LABEL_FIELD_LABELS,
  LABEL_PAPER_PRESETS,
  LabelAlign,
  LabelConfig,
  LabelField,
  loadLabelConfig,
  saveLabelConfig,
} from '@/lib/label-config';

const round = (v: number) => Math.round(v * 2) / 2; // snap to 0.5mm
type Sel = { kind: 'field'; id: LabelField } | { kind: 'custom'; id: string };
type DragState = {
  sel: Sel;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origFont: number;
  origBW: number;
  origBH: number;
};

export function LabelDesignerCard() {
  const [config, setConfig] = useState<LabelConfig>(DEFAULT_LABEL_CONFIG);
  const [selected, setSelected] = useState<Sel>({ kind: 'field', id: 'name' });
  const [zoom, setZoom] = useState(10); // px per mm — user adjustable for a bigger workspace
  const drag = useRef<DragState | null>(null);
  const token = useAuthStore((s) => s.accessToken);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const c = loadLabelConfig();
    setConfig(c);
    setZoom(Math.max(8, Math.min(16, 620 / c.widthMm)));
  }, []);

  const scale = zoom;

  const setField = (f: LabelField, patch: Partial<LabelConfig['fields'][LabelField]>) =>
    setConfig((c) => ({ ...c, fields: { ...c.fields, [f]: { ...c.fields[f], ...patch } } }));
  const setCustom = (id: string, patch: Partial<LabelConfig['custom'][number]>) =>
    setConfig((c) => ({ ...c, custom: c.custom.map((el) => (el.id === id ? { ...el, ...patch } : el)) }));

  const isSel = (kind: Sel['kind'], id: string) => selected.kind === kind && selected.id === id;
  const selField = selected.kind === 'field' ? config.fields[selected.id] : null;
  const selCustom = selected.kind === 'custom' ? config.custom.find((c) => c.id === selected.id) ?? null : null;
  const selPos = selField ?? selCustom;
  const selIsBarcode = selected.kind === 'field' && selected.id === 'barcode';

  const startDrag = (sel: Sel, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    setSelected(sel);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pos = sel.kind === 'field' ? config.fields[sel.id] : config.custom.find((c) => c.id === sel.id);
    if (!pos) return;
    drag.current = {
      sel, mode, startX: e.clientX, startY: e.clientY,
      origX: pos.xMm, origY: pos.yMm, origFont: pos.fontPt,
      origBW: config.barcodeWidthMm || 0, origBH: config.barcodeHeightMm,
    };
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    const apply = (patch: Record<string, unknown>) =>
      d.sel.kind === 'field' ? setField(d.sel.id, patch) : setCustom(d.sel.id, patch);
    if (d.mode === 'move') {
      apply({ xMm: Math.max(0, Math.min(config.widthMm, round(d.origX + dx))), yMm: Math.max(0, Math.min(config.heightMm, round(d.origY + dy))) });
    } else if (d.sel.kind === 'field' && d.sel.id === 'barcode') {
      setConfig((c) => ({
        ...c,
        barcodeHeightMm: Math.max(4, round(d.origBH + dy)),
        barcodeWidthMm: Math.max(0, round(d.origBW + dx)),
      }));
    } else {
      // Resize text = change font size (drag down/right grows it).
      apply({ fontPt: Math.max(5, Math.min(72, Math.round(d.origFont + (dx + dy) * 0.6))) });
    }
  };
  const onPointerUp = () => { drag.current = null; };

  const addCustom = () => {
    const id = `c${Date.now().toString(36)}`;
    setConfig((c) => ({ ...c, custom: [...c.custom, { id, text: 'New text', xMm: 2, yMm: 2, fontPt: 8, bold: false, align: 'left' }] }));
    setSelected({ kind: 'custom', id });
  };
  const removeCustom = (id: string) => {
    setConfig((c) => ({ ...c, custom: c.custom.filter((el) => el.id !== id) }));
    if (isSel('custom', id)) setSelected({ kind: 'field', id: 'name' });
  };

  const save = () => { saveLabelConfig(config); toast.success('Label design saved'); };
  const reset = () => { setConfig(DEFAULT_LABEL_CONFIG); saveLabelConfig(DEFAULT_LABEL_CONFIG); setSelected({ kind: 'field', id: 'name' }); toast.success('Reset to default label'); };

  // Print ONE sample label using the CURRENT (unsaved) config, so the shop can change the
  // rotation, print, look, and adjust — the tight loop that's needed to fix sideways printing.
  const testPrint = async () => {
    if (!token) { toast.error('Please sign in to test print'); return; }
    setTesting(true);
    try {
      const { dataUrl } = await api<{ dataUrl: string }>(`/items/barcode-image?text=8901234567890`, { token });
      const sample: TagSpec = {
        dataUrl, barcode: '8901234567890', name: 'Sample Item', price: 99, qty: 1,
        mrp: 120, category: 'Category', sku: 'SKU-001', size: 'M', colour: 'Blue',
      };
      printBarcodeTags([sample], config);
    } catch {
      toast.error('Could not fetch sample barcode');
    } finally {
      setTesting(false);
    }
  };

  const presetLabel = LABEL_PAPER_PRESETS.find((p) => p.widthMm === config.widthMm && p.heightMm === config.heightMm)?.label ?? 'Custom';

  const sampleText = (f: LabelField): string => {
    switch (f) {
      case 'name': return 'Item Name';
      case 'price': return '₹99.00';
      case 'mrp': return 'MRP ₹120';
      case 'category': return 'Category';
      case 'size': return 'M';
      case 'colour': return 'Blue';
      case 'sku': return 'SKU-001';
      case 'barcodeNumber': return '8901234567890';
      default: return f;
    }
  };

  const handle = (sel: Sel) => (
    <div
      onPointerDown={startDrag(sel, 'resize')}
      onPointerUp={onPointerUp}
      title="Drag to resize"
      style={{
        position: 'absolute', right: -6, bottom: -6, width: 13, height: 13, borderRadius: 3,
        background: 'hsl(348,85%,52%)', border: '2px solid #fff', cursor: 'nwse-resize', touchAction: 'none', zIndex: 5,
      }}
    />
  );

  const alignBtns = (align: LabelAlign | undefined, set: (a: LabelAlign) => void) => (
    <div className="flex gap-1">
      {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => (
        <button key={a} type="button" className={`h-8 w-8 rounded border flex items-center justify-center ${(align ?? 'left') === a ? 'bg-primary text-primary-foreground border-primary' : ''}`} onClick={() => set(a)}>
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );

  // Mirror print-tags.ts geometry exactly so the "How it prints" preview matches the printout:
  // for 90/270 the physical sheet is the swapped size and the label is rotated + centered into it.
  const rot = [90, 180, 270].includes(config.rotateDeg as number) ? (config.rotateDeg as number) : 0;
  const swap = rot === 90 || rot === 270;
  const pageW = swap ? config.heightMm : config.widthMm;
  const pageH = swap ? config.widthMm : config.heightMm;
  const pscale = Math.max(4, Math.min(14, 240 / Math.max(pageW, pageH)));

  return (
    <Card className="p-4 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><Barcode className="h-5 w-5 text-[hsl(348,85%,52%)]" /> Barcode Label Designer</h2>
      <p className="text-sm text-muted-foreground">Drag any element to move it; drag the red corner handle to resize (font / barcode size). Add your own text, toggle fields, and set alignment. Saved on this device.</p>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Preview canvas — grows to fill, but can shrink so the controls keep their width */}
        <div className="lg:flex-1 min-w-0 w-full">
          <div className="flex items-center gap-2 mb-2">
            <ZoomIn className="h-4 w-4 text-muted-foreground" />
            <input type="range" min={5} max={26} step={1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-40" />
            <span className="text-xs text-muted-foreground">Zoom {Math.round(zoom * 10) / 10}×</span>
          </div>
          <div className="overflow-auto border rounded-lg bg-slate-50 p-4 w-full" style={{ maxHeight: 520 }}>
            <div
              className="relative bg-white shadow-sm mx-auto"
              style={{ width: config.widthMm * scale, height: config.heightMm * scale, outline: '2px dashed rgba(0,0,0,0.25)' }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerDown={() => { /* click empty space keeps selection */ }}
            >
              {LABEL_FIELDS.filter((f) => config.fields[f].show).map((f) => {
                const s = config.fields[f];
                const sel: Sel = { kind: 'field', id: f };
                const active = isSel('field', f);
                const box = {
                  position: 'absolute' as const, left: s.xMm * scale, top: s.yMm * scale, cursor: 'move' as const,
                  outline: active ? '1.5px solid hsl(348,85%,52%)' : '1px dashed rgba(0,0,0,0.15)',
                  background: active ? 'hsla(348,85%,52%,0.08)' : 'transparent', touchAction: 'none' as const,
                  textAlign: (s.align ?? 'left') as LabelAlign,
                };
                if (f === 'barcode') {
                  const bw = config.barcodeWidthMm && config.barcodeWidthMm > 0 ? config.barcodeWidthMm * scale : Math.min(config.widthMm * scale * 0.7, 28 * scale);
                  return (
                    <div key={f} onPointerDown={startDrag(sel, 'move')} onPointerUp={onPointerUp} style={box} title="Barcode">
                      <div style={{ height: config.barcodeHeightMm * scale, width: bw, background: 'repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)' }} />
                      {active && handle(sel)}
                    </div>
                  );
                }
                return (
                  <div key={f} onPointerDown={startDrag(sel, 'move')} onPointerUp={onPointerUp} style={{ ...box, fontSize: Math.max(6, s.fontPt), fontWeight: s.bold ? 700 : 400, whiteSpace: 'nowrap' }}>
                    {sampleText(f)}
                    {active && handle(sel)}
                  </div>
                );
              })}
              {config.custom.map((el) => {
                const sel: Sel = { kind: 'custom', id: el.id };
                const active = isSel('custom', el.id);
                return (
                  <div
                    key={el.id}
                    onPointerDown={startDrag(sel, 'move')}
                    onPointerUp={onPointerUp}
                    style={{
                      position: 'absolute', left: el.xMm * scale, top: el.yMm * scale, cursor: 'move',
                      outline: active ? '1.5px solid #2563eb' : '1px dashed rgba(37,99,235,0.3)',
                      background: active ? 'rgba(37,99,235,0.08)' : 'transparent', touchAction: 'none',
                      fontSize: Math.max(6, el.fontPt), fontWeight: el.bold ? 700 : 400, whiteSpace: 'nowrap',
                      textAlign: (el.align ?? 'left') as LabelAlign,
                    }}
                  >
                    {el.text || 'Text'}
                    {active && handle(sel)}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground text-center mt-1">{config.widthMm} × {config.heightMm} mm · live preview</p>
        </div>

        {/* Controls — fixed comfortable width on desktop so buttons never get crushed */}
        <div className="w-full lg:w-[360px] xl:w-[400px] shrink-0 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Elements</p>
            <Button size="sm" variant="outline" onClick={addCustom}><Plus className="h-4 w-4 mr-1" /> Add text</Button>
          </div>
          <div className="space-y-1">
            {LABEL_FIELDS.map((f) => (
              <div key={f} className={`flex items-center gap-2 rounded-md px-2 py-1 ${isSel('field', f) ? 'bg-primary/5' : ''}`}>
                <input type="checkbox" checked={config.fields[f].show} onChange={(e) => setField(f, { show: e.target.checked })} />
                <button type="button" className="flex-1 text-left text-sm" onClick={() => setSelected({ kind: 'field', id: f })}>{LABEL_FIELD_LABELS[f]}</button>
              </div>
            ))}
            {config.custom.map((el) => (
              <div key={el.id} className={`flex items-center gap-2 rounded-md px-2 py-1 ${isSel('custom', el.id) ? 'bg-blue-50' : ''}`}>
                <span className="text-[10px] text-blue-600 font-semibold">TEXT</span>
                <button type="button" className="flex-1 text-left text-sm truncate" onClick={() => setSelected({ kind: 'custom', id: el.id })}>{el.text || 'Text'}</button>
                <button type="button" className="text-muted-foreground hover:text-rose-600" onClick={() => removeCustom(el.id)}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>

          {selPos && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs font-semibold">Selected: {selected.kind === 'field' ? LABEL_FIELD_LABELS[selected.id as LabelField] : 'Custom text'}</p>
              {selCustom && (
                <label className="text-xs text-muted-foreground block">Text
                  <Input value={selCustom.text} onChange={(e) => setCustom(selCustom.id, { text: e.target.value })} />
                </label>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted-foreground">X (mm)
                  <Input type="number" step="0.5" value={selPos.xMm} onChange={(e) => (selected.kind === 'field' ? setField(selected.id, { xMm: Number(e.target.value) }) : setCustom(selected.id, { xMm: Number(e.target.value) }))} />
                </label>
                <label className="text-xs text-muted-foreground">Y (mm)
                  <Input type="number" step="0.5" value={selPos.yMm} onChange={(e) => (selected.kind === 'field' ? setField(selected.id, { yMm: Number(e.target.value) }) : setCustom(selected.id, { yMm: Number(e.target.value) }))} />
                </label>
                {selIsBarcode ? (
                  <>
                    <label className="text-xs text-muted-foreground">Barcode H (mm)
                      <Input type="number" min="4" step="1" value={config.barcodeHeightMm} onChange={(e) => setConfig((c) => ({ ...c, barcodeHeightMm: Number(e.target.value) || c.barcodeHeightMm }))} />
                    </label>
                    <label className="text-xs text-muted-foreground">Barcode W (mm, 0=auto)
                      <Input type="number" min="0" step="1" value={config.barcodeWidthMm ?? 0} onChange={(e) => setConfig((c) => ({ ...c, barcodeWidthMm: Number(e.target.value) }))} />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="text-xs text-muted-foreground">Font (px)
                      <Input type="number" step="1" value={selPos.fontPt} onChange={(e) => (selected.kind === 'field' ? setField(selected.id, { fontPt: Number(e.target.value) }) : setCustom(selected.id, { fontPt: Number(e.target.value) }))} />
                    </label>
                    <label className="text-xs text-muted-foreground flex items-end gap-2 pb-2">
                      <input type="checkbox" checked={selPos.bold} onChange={(e) => (selected.kind === 'field' ? setField(selected.id, { bold: e.target.checked }) : setCustom(selected.id, { bold: e.target.checked }))} /> Bold
                    </label>
                  </>
                )}
              </div>
              {!selIsBarcode && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Align</span>
                  {alignBtns(selPos.align, (a) => (selected.kind === 'field' ? setField(selected.id, { align: a }) : setCustom(selected.id, { align: a })))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Paper preset</label>
              <select
                className="h-10 w-full rounded-lg border px-3 text-sm bg-background"
                value={presetLabel}
                onChange={(e) => { const p = LABEL_PAPER_PRESETS.find((x) => x.label === e.target.value); if (p) { setConfig((c) => ({ ...c, widthMm: p.widthMm, heightMm: p.heightMm })); setZoom(Math.max(8, Math.min(16, 620 / p.widthMm))); } }}
              >
                {LABEL_PAPER_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
                <option value="Custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Width (mm)</label>
              <Input type="number" min="10" step="1" value={config.widthMm} onChange={(e) => setConfig((c) => ({ ...c, widthMm: Number(e.target.value) || c.widthMm }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Height (mm)</label>
              <Input type="number" min="10" step="1" value={config.heightMm} onChange={(e) => setConfig((c) => ({ ...c, heightMm: Number(e.target.value) || c.heightMm }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Barcode height (mm)</label>
              <Input type="number" min="4" step="1" value={config.barcodeHeightMm} onChange={(e) => setConfig((c) => ({ ...c, barcodeHeightMm: Number(e.target.value) || c.barcodeHeightMm }))} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Print orientation</label>
              <select
                className="h-10 w-full rounded-lg border px-3 text-sm bg-background"
                value={config.rotateDeg ?? 0}
                onChange={(e) => setConfig((c) => ({ ...c, rotateDeg: Number(e.target.value) as 0 | 90 | 180 | 270 }))}
              >
                <option value={0}>Normal</option>
                <option value={90}>Rotate right (90°)</option>
                <option value={180}>Upside-down (180°)</option>
                <option value={270}>Rotate left (270°)</option>
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                If your labels print sideways (text runs up/down), choose <b>Rotate right (90°)</b>.
                If it comes out sideways the other way, choose <b>Rotate left (270°)</b>. Watch the
                “How it prints” preview below and use <b>Test print</b> to confirm.
              </p>
            </div>
          </div>

          {/* Read-only preview that applies the print orientation — mirrors print-tags geometry so
              the shop can SEE (and trust) what will come out of the printer before wasting labels.
              Kept separate from the editable canvas above, which stays un-rotated so drag stays correct. */}
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs font-semibold">How it prints (on the roll)</p>
            <div className="overflow-auto bg-slate-100 rounded p-3 flex justify-center">
              <div
                style={{
                  position: 'relative', width: pageW * pscale, height: pageH * pscale,
                  background: '#e2e8f0', outline: '1px dashed rgba(0,0,0,0.3)', overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute', left: '50%', top: '50%',
                    width: config.widthMm * pscale, height: config.heightMm * pscale,
                    background: '#fff', overflow: 'hidden',
                    transformOrigin: 'center', transform: `translate(-50%, -50%) rotate(${rot}deg)`,
                  }}
                >
                  {LABEL_FIELDS.filter((f) => config.fields[f].show).map((f) => {
                    const s = config.fields[f];
                    if (f === 'barcode') {
                      const bw = config.barcodeWidthMm && config.barcodeWidthMm > 0 ? config.barcodeWidthMm * pscale : Math.min(config.widthMm * pscale * 0.7, 28 * pscale);
                      return <div key={f} style={{ position: 'absolute', left: s.xMm * pscale, top: s.yMm * pscale, height: config.barcodeHeightMm * pscale, width: bw, background: 'repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)' }} />;
                    }
                    return (
                      <div key={f} style={{ position: 'absolute', left: s.xMm * pscale, top: s.yMm * pscale, fontSize: Math.max(5, s.fontPt), fontWeight: s.bold ? 700 : 400, whiteSpace: 'nowrap', maxWidth: config.widthMm * pscale, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: (s.align ?? 'left') as LabelAlign }}>
                        {sampleText(f)}
                      </div>
                    );
                  })}
                  {config.custom.map((el) => (
                    <div key={el.id} style={{ position: 'absolute', left: el.xMm * pscale, top: el.yMm * pscale, fontSize: Math.max(5, el.fontPt), fontWeight: el.bold ? 700 : 400, whiteSpace: 'nowrap', maxWidth: config.widthMm * pscale, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: (el.align ?? 'left') as LabelAlign }}>
                      {el.text || 'Text'}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              {pageW} × {pageH} mm page as sent to the printer · use <b>Test print</b> to confirm the real label
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save}>Save label design</Button>
        <Button variant="outline" disabled={testing} onClick={testPrint}>{testing ? 'Preparing…' : 'Test print (1 label)'}</Button>
        <Button variant="outline" onClick={reset}>Reset to default</Button>
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">Printer setup tips (if labels print sideways or the wrong size)</summary>
        <ol className="list-decimal ml-5 mt-2 space-y-1">
          <li>In the print dialog, pick your <b>label printer</b> (e.g. TVS LP 46 DLITE) — not “Save as PDF”.</li>
          <li>Set <b>Paper size</b> to your exact label, e.g. {config.widthMm} × {config.heightMm} mm (create a custom size in Windows if it isn’t listed) — not A4/Letter.</li>
          <li>Set <b>Scale</b> to <b>100%</b> / Actual size — never “Fit to page”.</li>
          <li>Set <b>Margins</b> to <b>None</b>, and turn <b>Background graphics ON</b> so the barcode prints.</li>
          <li>Still sideways? Change <b>Print orientation</b> above (try 90°, then 270°) and watch the “How it prints” preview, then Test print.</li>
        </ol>
      </details>
    </Card>
  );
}
