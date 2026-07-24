'use client';

import { useEffect, useRef, useState } from 'react';
import { Barcode } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DEFAULT_LABEL_CONFIG,
  LABEL_FIELDS,
  LABEL_FIELD_LABELS,
  LABEL_PAPER_PRESETS,
  LabelConfig,
  LabelField,
  loadLabelConfig,
  saveLabelConfig,
} from '@/lib/label-config';

const round = (v: number) => Math.round(v * 2) / 2; // snap to 0.5mm

export function LabelDesignerCard() {
  const [config, setConfig] = useState<LabelConfig>(DEFAULT_LABEL_CONFIG);
  const [selected, setSelected] = useState<LabelField>('name');
  const drag = useRef<{ field: LabelField; startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => { setConfig(loadLabelConfig()); }, []);

  // px-per-mm so the preview fits comfortably.
  const scale = Math.max(3, Math.min(7, 340 / config.widthMm));

  const setField = (f: LabelField, patch: Partial<LabelConfig['fields'][LabelField]>) =>
    setConfig((c) => ({ ...c, fields: { ...c.fields, [f]: { ...c.fields[f], ...patch } } }));

  const onPointerDown = (f: LabelField) => (e: React.PointerEvent) => {
    setSelected(f);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const s = config.fields[f];
    drag.current = { field: f, startX: e.clientX, startY: e.clientY, origX: s.xMm, origY: s.yMm };
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    const xMm = Math.max(0, Math.min(config.widthMm, round(d.origX + dx)));
    const yMm = Math.max(0, Math.min(config.heightMm, round(d.origY + dy)));
    setField(d.field, { xMm, yMm });
  };
  const onPointerUp = () => { drag.current = null; };

  const save = () => { saveLabelConfig(config); toast.success('Label design saved'); };
  const reset = () => { setConfig(DEFAULT_LABEL_CONFIG); saveLabelConfig(DEFAULT_LABEL_CONFIG); toast.success('Reset to default label'); };

  const presetLabel = LABEL_PAPER_PRESETS.find((p) => p.widthMm === config.widthMm && p.heightMm === config.heightMm)?.label ?? 'Custom';
  const sel = config.fields[selected];

  // Sample text shown in the preview per field.
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

  return (
    <Card className="p-4 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><Barcode className="h-5 w-5 text-[hsl(348,85%,52%)]" /> Barcode Label Designer</h2>
      <p className="text-sm text-muted-foreground">Drag fields to position them on the label. Toggle fields on/off and set font size. Saved on this device.</p>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Preview canvas */}
        <div className="shrink-0">
          <div
            className="relative bg-white border-2 border-dashed border-muted-foreground/40 mx-auto"
            style={{ width: config.widthMm * scale, height: config.heightMm * scale }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {LABEL_FIELDS.filter((f) => config.fields[f].show).map((f) => {
              const s = config.fields[f];
              const isSel = selected === f;
              const common = {
                onPointerDown: onPointerDown(f),
                onPointerUp,
                style: {
                  position: 'absolute' as const,
                  left: s.xMm * scale,
                  top: s.yMm * scale,
                  cursor: 'move' as const,
                  outline: isSel ? '1px solid hsl(348,85%,52%)' : '1px dashed transparent',
                  background: isSel ? 'hsla(348,85%,52%,0.08)' : 'transparent',
                  touchAction: 'none' as const,
                },
              };
              if (f === 'barcode') {
                return (
                  <div key={f} {...common} title="Barcode">
                    <div style={{ height: config.barcodeHeightMm * scale, width: 28 * scale > config.widthMm * scale ? config.widthMm * scale * 0.7 : 28 * scale, background: 'repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)' }} />
                  </div>
                );
              }
              return (
                <div key={f} {...common} style={{ ...common.style, fontSize: Math.max(7, s.fontPt), fontWeight: s.bold ? 700 : 400, whiteSpace: 'nowrap' }}>
                  {sampleText(f)}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground text-center mt-1">{config.widthMm} × {config.heightMm} mm · preview (approx.)</p>
        </div>

        {/* Controls */}
        <div className="flex-1 space-y-4 min-w-0">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Fields (click to select, checkbox to show)</p>
            <div className="space-y-1">
              {LABEL_FIELDS.map((f) => (
                <div key={f} className={`flex items-center gap-2 rounded-md px-2 py-1 ${selected === f ? 'bg-primary/5' : ''}`}>
                  <input type="checkbox" checked={config.fields[f].show} onChange={(e) => setField(f, { show: e.target.checked })} />
                  <button type="button" className="flex-1 text-left text-sm" onClick={() => setSelected(f)}>{LABEL_FIELD_LABELS[f]}</button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs font-semibold">Selected: {LABEL_FIELD_LABELS[selected]}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground">X (mm)
                <Input type="number" step="0.5" value={sel.xMm} onChange={(e) => setField(selected, { xMm: Number(e.target.value) })} />
              </label>
              <label className="text-xs text-muted-foreground">Y (mm)
                <Input type="number" step="0.5" value={sel.yMm} onChange={(e) => setField(selected, { yMm: Number(e.target.value) })} />
              </label>
              {selected !== 'barcode' && (
                <>
                  <label className="text-xs text-muted-foreground">Font (px)
                    <Input type="number" step="1" value={sel.fontPt} onChange={(e) => setField(selected, { fontPt: Number(e.target.value) })} />
                  </label>
                  <label className="text-xs text-muted-foreground flex items-end gap-2 pb-2">
                    <input type="checkbox" checked={sel.bold} onChange={(e) => setField(selected, { bold: e.target.checked })} /> Bold
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-3">
              <label className="text-xs font-medium text-muted-foreground">Paper preset</label>
              <select
                className="h-10 w-full rounded-lg border px-3 text-sm bg-background"
                value={presetLabel}
                onChange={(e) => { const p = LABEL_PAPER_PRESETS.find((x) => x.label === e.target.value); if (p) setConfig((c) => ({ ...c, widthMm: p.widthMm, heightMm: p.heightMm })); }}
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
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={save}>Save label design</Button>
        <Button variant="outline" onClick={reset}>Reset to default</Button>
      </div>
    </Card>
  );
}
