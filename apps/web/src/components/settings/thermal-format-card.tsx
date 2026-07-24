'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SectionCfg { id: string; show: boolean }
interface ReceiptLayout { fontPx?: number; sections?: SectionCfg[] }

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
const DEFAULT_ORDER = ['shopName', 'gstin', 'branch', 'header', 'meta', 'items', 'totals', 'payments', 'footer'];

export function ThermalFormatCard() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [fontPx, setFontPx] = useState(12);
  const [sections, setSections] = useState<SectionCfg[]>(DEFAULT_ORDER.map((id) => ({ id, show: true })));

  const { data } = useQuery({
    queryKey: ['firm-settings'],
    queryFn: () => api<{ receiptLayout?: ReceiptLayout | null }>('/settings/firm', { token }),
    enabled: !!token,
  });

  useEffect(() => {
    const layout = data?.receiptLayout;
    if (layout?.sections?.length) {
      const known = new Set(DEFAULT_ORDER);
      const listed = layout.sections.filter((s) => known.has(s.id));
      const listedIds = new Set(listed.map((s) => s.id));
      setSections([...listed, ...DEFAULT_ORDER.filter((id) => !listedIds.has(id)).map((id) => ({ id, show: true }))]);
    }
    if (layout?.fontPx) setFontPx(layout.fontPx);
  }, [data]);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    setSections((s) => { const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  };
  const toggle = (i: number) => setSections((s) => s.map((sec, idx) => (idx === i ? { ...sec, show: !sec.show } : sec)));

  const save = useMutation({
    mutationFn: () => api('/settings/firm', { method: 'PATCH', token, body: JSON.stringify({ receiptLayout: { fontPx, sections } }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['firm-settings'] }); toast.success('Thermal bill format saved'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-4 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><Receipt className="h-5 w-5 text-[hsl(348,85%,52%)]" /> Thermal Bill Format</h2>
      <p className="text-sm text-muted-foreground">Reorder and show/hide the sections that print on the 80mm bill, and set the base font size.</p>

      <div className="max-w-md space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Base font size (px)</label>
        <Input type="number" min="9" max="18" step="1" value={fontPx} onChange={(e) => setFontPx(Number(e.target.value) || 12)} className="w-28" />
      </div>

      <div className="max-w-md divide-y rounded-lg border">
        {sections.map((sec, i) => (
          <div key={sec.id} className="flex items-center gap-2 px-3 py-2">
            <input type="checkbox" checked={sec.show} onChange={() => toggle(i)} />
            <span className={`flex-1 text-sm ${sec.show ? '' : 'text-muted-foreground line-through'}`}>{SECTION_LABELS[sec.id] ?? sec.id}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)} title="Move up"><ArrowUp className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === sections.length - 1} onClick={() => move(i, 1)} title="Move down"><ArrowDown className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save bill format</Button>
        <Button variant="outline" onClick={() => { setFontPx(12); setSections(DEFAULT_ORDER.map((id) => ({ id, show: true }))); }}>Reset</Button>
      </div>
    </Card>
  );
}
