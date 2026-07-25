'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Plus, Receipt, Trash2, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Align = 'left' | 'center' | 'right';
interface LayoutItem {
  id: string;
  kind?: 'text';
  text?: string;
  show: boolean;
  fontPx?: number;
  align?: Align;
  bold?: boolean;
}
interface ReceiptLayout { fontPx?: number; sections?: LayoutItem[] }

const SECTION_LABELS: Record<string, string> = {
  shopName: 'Shop name',
  gstin: 'GSTIN',
  branch: 'Branch name',
  header: 'Header line',
  meta: 'Bill no / date / party',
  items: 'Items',
  totals: 'Totals',
  payments: 'Payments & balance due',
  footer: 'Footer / thank-you',
};
const SAMPLE: Record<string, string> = {
  shopName: 'MSW GLOBAL',
  gstin: 'GSTIN: 29ABCDE1234F1Z5',
  branch: 'Main Branch',
  header: 'Welcome!',
  meta: 'INVOICE · No INV-1024',
  items: 'T-Shirt (M) × 1     ₹499.00',
  totals: 'TOTAL     ₹499.00',
  payments: 'CASH      ₹499.00',
  footer: 'Thank you! Visit again',
};
const DEFAULT_ORDER = ['shopName', 'gstin', 'branch', 'header', 'meta', 'items', 'totals', 'payments', 'footer'];
const defaultItems = (): LayoutItem[] => DEFAULT_ORDER.map((id) => ({ id, show: true, align: 'center' as Align }));

export function ThermalFormatCard() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [fontPx, setFontPx] = useState(12);
  const [items, setItems] = useState<LayoutItem[]>(defaultItems());
  const [selected, setSelected] = useState<string | null>(null);
  const dragIdx = useRef<number | null>(null);

  const { data } = useQuery({
    queryKey: ['firm-settings'],
    queryFn: () => api<{ receiptLayout?: ReceiptLayout | null }>('/settings/firm', { token }),
    enabled: !!token,
  });

  useEffect(() => {
    const layout = data?.receiptLayout;
    if (layout?.sections?.length) {
      const arr = layout.sections.map((s) => ({ align: 'center' as Align, ...s, show: s.show !== false })) as LayoutItem[];
      const listedKnown = new Set(arr.filter((s) => DEFAULT_ORDER.includes(s.id)).map((s) => s.id));
      const missing = DEFAULT_ORDER.filter((id) => !listedKnown.has(id)).map((id) => ({ id, show: true, align: 'center' as Align }));
      setItems([...arr, ...missing]);
    }
    if (layout?.fontPx) setFontPx(layout.fontPx);
  }, [data]);

  const patch = (idx: number, p: Partial<LayoutItem>) => setItems((s) => s.map((it, i) => (i === idx ? { ...it, ...p } : it)));
  const removeAt = (idx: number) => setItems((s) => s.filter((_, i) => i !== idx));
  const addText = () => {
    const id = `t${Date.now().toString(36)}`;
    setItems((s) => [...s, { id, kind: 'text', text: 'Custom line', show: true, align: 'center' }]);
    setSelected(id);
  };

  const onDrop = (to: number) => {
    const from = dragIdx.current;
    dragIdx.current = null;
    if (from == null || from === to) return;
    setItems((s) => {
      const n = [...s];
      const [moved] = n.splice(from, 1);
      n.splice(to, 0, moved);
      return n;
    });
  };

  const save = useMutation({
    mutationFn: () => api('/settings/firm', { method: 'PATCH', token, body: JSON.stringify({ receiptLayout: { fontPx, sections: items } }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['firm-settings'] }); toast.success('Thermal bill format saved'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const labelOf = (it: LayoutItem) => (it.kind === 'text' ? (it.text || 'Text') : SECTION_LABELS[it.id] ?? it.id);
  const sel = items.find((it) => it.id === selected) ?? null;
  const selIdx = items.findIndex((it) => it.id === selected);

  return (
    <Card className="p-4 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><Receipt className="h-5 w-5 text-[hsl(348,85%,52%)]" /> Thermal Bill Designer</h2>
      <p className="text-sm text-muted-foreground">Drag rows to reorder, show/hide sections, add your own text lines, and set per-section font size &amp; alignment. Live 80mm preview on the left.</p>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Preview */}
        <div className="shrink-0">
          <div className="border rounded-lg bg-slate-100 p-4">
            <div className="bg-white shadow-sm mx-auto px-3 py-3" style={{ width: 300, fontFamily: 'Courier New, monospace', color: '#000' }}>
              {items.filter((it) => it.show).map((it, i, arr) => {
                const text = it.kind === 'text' ? (it.text || '') : SAMPLE[it.id] ?? it.id;
                if (!text) return null;
                return (
                  <div key={it.id}>
                    <div style={{ textAlign: it.align ?? 'center', fontSize: (it.fontPx ?? fontPx), fontWeight: it.bold ? 700 : (it.id === 'shopName' || it.id === 'totals' ? 700 : 400), lineHeight: 1.4, wordBreak: 'break-word' }}>
                      {text}
                    </div>
                    {i < arr.length - 1 && <div style={{ borderTop: '1px dashed #999', margin: '5px 0' }} />}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground text-center mt-1">80 mm thermal roll · live preview</p>
        </div>

        {/* Controls */}
        <div className="flex-1 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              Base font (px)
              <Input type="number" min="9" max="20" step="1" value={fontPx} onChange={(e) => setFontPx(Number(e.target.value) || 12)} className="w-20" />
            </label>
            <Button size="sm" variant="outline" onClick={addText}><Plus className="h-4 w-4 mr-1" /> Add text line</Button>
          </div>

          <div className="divide-y rounded-lg border">
            {items.map((it, i) => (
              <div
                key={it.id}
                draggable
                onDragStart={() => { dragIdx.current = i; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(i)}
                onClick={() => setSelected(it.id)}
                className={`flex items-center gap-2 px-2 py-2 cursor-grab ${selected === it.id ? 'bg-primary/5' : ''}`}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                <input type="checkbox" checked={it.show} onChange={(e) => patch(i, { show: e.target.checked })} onClick={(e) => e.stopPropagation()} />
                <span className={`flex-1 text-sm truncate ${it.show ? '' : 'text-muted-foreground line-through'}`}>
                  {labelOf(it)}{it.kind === 'text' && <span className="text-[10px] text-blue-600 ml-1">TEXT</span>}
                </span>
                {it.kind === 'text' && (
                  <button type="button" className="text-muted-foreground hover:text-rose-600" onClick={(e) => { e.stopPropagation(); removeAt(i); }}><Trash2 className="h-4 w-4" /></button>
                )}
              </div>
            ))}
          </div>

          {sel && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs font-semibold">Selected: {labelOf(sel)}</p>
              {sel.kind === 'text' && (
                <label className="text-xs text-muted-foreground block">Text
                  <Input value={sel.text ?? ''} onChange={(e) => patch(selIdx, { text: e.target.value })} />
                </label>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-muted-foreground">Font (px)
                  <Input type="number" min="8" max="28" step="1" value={sel.fontPx ?? ''} placeholder={String(fontPx)} onChange={(e) => patch(selIdx, { fontPx: e.target.value ? Number(e.target.value) : undefined })} className="w-20" />
                </label>
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Align</span>
                  <div className="flex gap-1">
                    {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => (
                      <button key={a} type="button" className={`h-8 w-8 rounded border flex items-center justify-center ${(sel.align ?? 'center') === a ? 'bg-primary text-primary-foreground border-primary' : ''}`} onClick={() => patch(selIdx, { align: a })}>
                        <Icon className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                </div>
                <label className="text-xs text-muted-foreground flex items-center gap-1.5 pb-2">
                  <input type="checkbox" checked={!!sel.bold} onChange={(e) => patch(selIdx, { bold: e.target.checked })} /> Bold
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save bill format</Button>
        <Button variant="outline" onClick={() => { setFontPx(12); setItems(defaultItems()); setSelected(null); }}>Reset</Button>
      </div>
    </Card>
  );
}
