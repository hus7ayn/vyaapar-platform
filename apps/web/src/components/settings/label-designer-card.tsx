'use client';

import { useEffect, useState } from 'react';
import { Barcode } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DEFAULT_LABEL_CONFIG,
  LABEL_FIELD_LABELS,
  LABEL_PAPER_PRESETS,
  LabelConfig,
  LabelField,
  loadLabelConfig,
  saveLabelConfig,
} from '@/lib/label-config';

export function LabelDesignerCard() {
  const [config, setConfig] = useState<LabelConfig>(DEFAULT_LABEL_CONFIG);

  useEffect(() => { setConfig(loadLabelConfig()); }, []);

  const toggleField = (f: LabelField) =>
    setConfig((c) => ({ ...c, fields: { ...c.fields, [f]: !c.fields[f] } }));

  const setNum = (key: keyof LabelConfig, v: string) =>
    setConfig((c) => ({ ...c, [key]: Number(v) || 0 }));

  const save = () => { saveLabelConfig(config); toast.success('Label design saved'); };
  const reset = () => { setConfig(DEFAULT_LABEL_CONFIG); saveLabelConfig(DEFAULT_LABEL_CONFIG); toast.success('Reset to default label'); };

  const presetLabel = LABEL_PAPER_PRESETS.find((p) => p.widthMm === config.widthMm && p.heightMm === config.heightMm)?.label ?? 'Custom';

  return (
    <Card className="p-4 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><Barcode className="h-5 w-5 text-[hsl(348,85%,52%)]" /> Barcode Label Designer</h2>
      <p className="text-sm text-muted-foreground">Choose what prints on each barcode label and its size. Saved on this device.</p>

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Fields to print</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LABEL_FIELD_LABELS) as LabelField[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => toggleField(f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${config.fields[f] ? 'bg-primary text-white border-primary' : 'bg-background text-muted-foreground'}`}
            >
              {LABEL_FIELD_LABELS[f]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">The barcode image always prints. Size/Colour show only when the item has that data.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="col-span-2 sm:col-span-3">
          <label className="text-xs font-medium text-muted-foreground">Paper preset</label>
          <select
            className="h-10 w-full rounded-lg border px-3 text-sm bg-background"
            value={presetLabel}
            onChange={(e) => {
              const p = LABEL_PAPER_PRESETS.find((x) => x.label === e.target.value);
              if (p) setConfig((c) => ({ ...c, widthMm: p.widthMm, heightMm: p.heightMm }));
            }}
          >
            {LABEL_PAPER_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            <option value="Custom">Custom</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Width (mm)</label>
          <Input type="number" min="10" step="1" value={config.widthMm} onChange={(e) => setNum('widthMm', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Height (mm)</label>
          <Input type="number" min="10" step="1" value={config.heightMm} onChange={(e) => setNum('heightMm', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Margin (mm)</label>
          <Input type="number" min="0" step="0.5" value={config.marginMm} onChange={(e) => setNum('marginMm', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Font size (px)</label>
          <Input type="number" min="5" step="1" value={config.fontPt} onChange={(e) => setNum('fontPt', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Barcode height (mm)</label>
          <Input type="number" min="4" step="1" value={config.barcodeHeightMm} onChange={(e) => setNum('barcodeHeightMm', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Alignment</label>
          <select
            className="h-10 w-full rounded-lg border px-3 text-sm bg-background"
            value={config.align}
            onChange={(e) => setConfig((c) => ({ ...c, align: e.target.value as LabelConfig['align'] }))}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={save}>Save label design</Button>
        <Button variant="outline" onClick={reset}>Reset to default</Button>
      </div>
    </Card>
  );
}
