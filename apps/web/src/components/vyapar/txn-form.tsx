'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatMoney, PAYMENT_TYPES, TXN_META, Txn, TxnType } from '@/lib/txn-meta';

interface Party {
  id: string;
  name: string;
  phone?: string | null;
  gstin?: string | null;
  currentBalance: string | number;
  partyType: string;
}

interface Item {
  id: string;
  name: string;
  sku: string;
  size?: string | null;
  hsnCode?: string | null;
  salePrice: string | number;
  purchasePrice: string | number;
  wholesalePrice?: string | number | null;
  taxRate: string | number;
  baseUnit: string;
  currentStock: string | number;
  itemType: string;
}

interface BankAccount {
  id: string;
  name: string;
  accountType: string;
  balance: string | number;
}

interface FormLine {
  key: number;
  itemId?: string;
  name: string;
  hsnCode?: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  /** Raw discount input — read as a percentage or a rupee amount depending on discountType. */
  discountValue: string;
  discountType: 'PCT' | 'AMT';
  taxRate: string;
}

/** Discount on one line, in rupees. A rupee discount can never exceed the line's gross. */
function lineDiscount(l: FormLine, gross: number): number {
  const value = Number(l.discountValue) || 0;
  return l.discountType === 'AMT' ? Math.min(value, gross) : gross * (value / 100);
}

/**
 * Ancestors that can clip the anchor out of sight — <main>'s scroller, the line-item table's
 * own horizontal scroller. Collected once when the panel opens; only their rects are read
 * afterwards, so scrolling stays cheap. They bound VISIBILITY only, never the panel's size:
 * the panel is portalled out of them precisely so it can overflow them.
 */
function clippingAncestors(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') out.push(p);
  }
  return out;
}

/**
 * An autocomplete list rendered into <body> instead of next to its input.
 *
 * The line-items table has to scroll sideways on a phone, and an `overflow-x-auto` ancestor
 * forces the other axis to `auto` as well — which would clip a normally-positioned dropdown and
 * break item search. Portalling it out sidesteps that, at the cost of having to place the panel
 * from the input's viewport rect and re-measure whenever anything scrolls or resizes.
 */
function AutocompleteDropdown({
  anchorEl,
  open,
  minWidth = 0,
  onClose,
  children,
}: {
  anchorEl: HTMLElement | null;
  open: boolean;
  minWidth?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  /**
   * Layout-viewport coordinates, which is what `position: fixed` resolves against.
   * `top` and `bottom` are mutually exclusive: a panel that drops upwards hangs off its BOTTOM
   * edge, because its height is content-driven (maxHeight only caps it). Subtracting maxHeight
   * from the input's top instead would leave a short filtered list floating in mid-air.
   */
  const [box, setBox] = useState<
    { top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null
  >(null);

  useEffect(() => {
    if (!open || !anchorEl) { setBox(null); return; }
    const clips = clippingAncestors(anchorEl);
    // iOS Safari never shrinks window.innerHeight for the on-screen keyboard — only
    // visualViewport reports the strip of screen the keyboard leaves — so measure against that
    // where it exists. Its offsets are relative to the same layout viewport that
    // getBoundingClientRect() and `position: fixed` use, so the two mix safely.
    const vv = window.visualViewport;
    const place = () => {
      const r = anchorEl.getBoundingClientRect();
      const viewTop = vv ? vv.offsetTop : 0;
      const viewBottom = viewTop + (vv ? vv.height : window.innerHeight);

      // Stay mounted but paint nothing once the input itself is out of sight — scrolled out of
      // <main>, off the table's side-scroller, or under the keyboard. Otherwise the panel hangs
      // over unrelated content (and over the sticky TopBar, which it outranks) until the next
      // click. It comes straight back when the input is scrolled into view again.
      let visTop = viewTop;
      let visBottom = viewBottom;
      let visLeft = vv ? vv.offsetLeft : 0;
      let visRight = visLeft + (vv ? vv.width : window.innerWidth);
      for (const clip of clips) {
        const c = clip.getBoundingClientRect();
        if (c.width === 0 && c.height === 0) continue; // laid out as `display: contents` — clips nothing
        visTop = Math.max(visTop, c.top);
        visBottom = Math.min(visBottom, c.bottom);
        visLeft = Math.max(visLeft, c.left);
        visRight = Math.min(visRight, c.right);
      }
      if (r.bottom <= visTop || r.top >= visBottom || r.right <= visLeft || r.left >= visRight) {
        setBox(null);
        return;
      }

      const width = Math.min(Math.max(r.width, minWidth), window.innerWidth - 16);
      const below = viewBottom - r.bottom - 8;
      const above = r.top - viewTop - 8;
      // Drop upwards when the field sits low on a short screen (phone with the keyboard up).
      const flip = below < 160 && above > below;
      setBox({
        // Pin the edge that touches the input: top when dropping down, bottom when flipped.
        top: flip ? undefined : r.bottom + 4,
        bottom: flip ? window.innerHeight - r.top + 4 : undefined,
        // Keep the panel on screen when its input sits near the right edge.
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width,
        maxHeight: Math.max(96, Math.min(224, flip ? above : below)),
      });
    };
    place();
    // Capture phase, because scroll doesn't bubble: this also catches <main> and the
    // table's own horizontal scroller.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    // The keyboard opening/closing on iOS fires neither of those — only these two.
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
    };
  }, [open, anchorEl, minWidth]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    // Pointer-down rather than click, so a pick (which runs on mouseDown) is never cancelled here.
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || anchorEl?.contains(target)) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open, anchorEl]);

  if (!open || !box) return null;
  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-50 bg-white border rounded-md shadow-lg overflow-auto"
      style={{ top: box.top, bottom: box.bottom, left: box.left, width: box.width, maxHeight: box.maxHeight }}
    >
      {children}
    </div>,
    document.body,
  );
}

let lineKey = 1;
const emptyLine = (): FormLine => ({
  key: lineKey++, name: '', quantity: '1', unit: 'PCS', unitPrice: '', discountValue: '', discountType: 'PCT', taxRate: '0',
});

export function TxnForm({ txnType, sourceTxn }: { txnType: TxnType; sourceTxn?: Txn }) {
  const meta = TXN_META[txnType];
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken) ?? undefined;
  const branchId = useAuthStore((s) => s.activeShopId) ?? undefined;
  const isPayment = txnType === 'PAYMENT_IN' || txnType === 'PAYMENT_OUT';
  const isExpense = txnType === 'EXPENSE';

  const [partyId, setPartyId] = useState<string | undefined>(sourceTxn?.partyId ?? undefined);
  const [partySearch, setPartySearch] = useState(sourceTxn?.partyName ?? '');
  const [partyOpen, setPartyOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<FormLine[]>(
    sourceTxn?.lines?.length
      ? sourceTxn.lines.map((l) => ({
          key: lineKey++,
          itemId: l.itemId ?? undefined,
          name: l.name,
          hsnCode: l.hsnCode ?? undefined,
          quantity: String(l.quantity),
          unit: l.unit,
          unitPrice: String(l.unitPrice),
          discountValue: l.discountPercent ? String(l.discountPercent) : (Number(l.discountAmount) ? String(l.discountAmount) : ''),
          discountType: (l.discountPercent ? 'PCT' : Number(l.discountAmount) ? 'AMT' : 'PCT') as 'PCT' | 'AMT',
          taxRate: String(l.taxRate),
        }))
      : [emptyLine()],
  );
  const [billDiscountPct, setBillDiscountPct] = useState('');
  const [billDiscountType, setBillDiscountType] = useState<'PCT' | 'AMT'>('PCT');
  const [shipping, setShipping] = useState('');
  const [roundOffEnabled, setRoundOffEnabled] = useState(true);
  const [amount, setAmount] = useState(''); // for payments/expense
  const [paymentType, setPaymentType] = useState('CASH');
  const [bankAccountId, setBankAccountId] = useState('');
  const [paidNow, setPaidNow] = useState('');
  const [creditSale, setCreditSale] = useState(false);
  const [description, setDescription] = useState('');
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [addingExpenseCategory, setAddingExpenseCategory] = useState(false);
  const [newExpenseCategory, setNewExpenseCategory] = useState('');
  const [activeItemRow, setActiveItemRow] = useState<number | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  // The autocomplete panels live in a portal, so they position themselves off these inputs.
  const partyInputRef = useRef<HTMLInputElement>(null);
  const itemInputRefs = useRef(new Map<number, HTMLInputElement>());

  const { data: parties } = useQuery({
    queryKey: ['parties-all'],
    queryFn: () => api<Party[]>('/parties', { token }),
    enabled: !!token,
  });

  const { data: items } = useQuery({
    queryKey: ['items-all'],
    queryFn: () => api<Item[]>('/items', { token }),
    enabled: !!token && meta.hasLines,
  });

  const { data: accounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api<BankAccount[]>('/cash-bank/accounts', { token }),
    enabled: !!token,
  });

  const { data: expenseCategories } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api<{ id: string; name: string }[]>('/expenses/categories', { token }),
    enabled: !!token && isExpense,
  });

  const addExpenseCategory = async () => {
    const name = newExpenseCategory.trim();
    if (!name) return;
    try {
      const cat = await api<{ id: string; name: string }>('/expenses/categories', { method: 'POST', token, body: JSON.stringify({ name }) });
      await queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      setExpenseCategoryId(cat.id);
      setNewExpenseCategory('');
      setAddingExpenseCategory(false);
      toast.success('Category added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add category');
    }
  };

  const filteredParties = useMemo(() => {
    const base = (parties ?? []).filter((p) =>
      !meta.partyType ? true
        : meta.partyType === 'CUSTOMER' ? ['CUSTOMER', 'BOTH'].includes(p.partyType)
        : ['SUPPLIER', 'BOTH'].includes(p.partyType),
    );
    if (!partySearch) return base.slice(0, 8);
    return base.filter((p) => p.name.toLowerCase().includes(partySearch.toLowerCase())).slice(0, 8);
  }, [parties, partySearch, meta.partyType]);

  const filteredItems = useMemo(() => {
    if (!itemSearch) return (items ?? []).slice(0, 8);
    const q = itemSearch.toLowerCase();
    return (items ?? []).filter((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || (i.size ?? '').toLowerCase().includes(q)).slice(0, 8);
  }, [items, itemSearch]);

  const selectedParty = parties?.find((p) => p.id === partyId);

  // ─── Totals ────────────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    let itemDiscount = 0;
    for (const l of lines) {
      const qty = Number(l.quantity) || 0;
      const price = Number(l.unitPrice) || 0;
      const gross = qty * price;
      const disc = lineDiscount(l, gross);
      itemDiscount += disc;
      const taxable = gross - disc;
      subtotal += taxable;
      tax += taxable * ((Number(l.taxRate) || 0) / 100);
    }
    const billDiscount = billDiscountType === 'AMT'
      ? Math.min(Number(billDiscountPct) || 0, subtotal + tax)
      : (subtotal + tax) * ((Number(billDiscountPct) || 0) / 100);
    const charges = Number(shipping) || 0;
    const raw = subtotal + tax - billDiscount + charges;
    const total = roundOffEnabled ? Math.round(raw) : raw;
    return { subtotal, tax, itemDiscount, billDiscount, charges, roundOff: total - raw, total };
  }, [lines, billDiscountPct, billDiscountType, shipping, roundOffEnabled]);

  const effectiveTotal = meta.hasLines ? totals.total : Number(amount) || 0;
  // Orders / quotations / delivery challans are not financial events — never treat them as paid
  // (the backend also drops any payment for them). Only real invoices/bills default to "received".
  const received = creditSale || meta.isOrder ? 0 : paidNow === '' ? effectiveTotal : Number(paidNow) || 0;
  const balance = Math.max(0, effectiveTotal - received);

  // ─── Save ──────────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payments = isPayment
        ? [{ paymentType, bankAccountId: bankAccountId || undefined, amount: effectiveTotal }]
        : [
            ...(received > 0 ? [{ paymentType, bankAccountId: bankAccountId || undefined, amount: received }] : []),
            ...(balance > 0 && meta.side !== 'other' && !meta.isOrder && partyId
              ? [{ paymentType: 'DEBT', amount: balance }]
              : []),
          ];

      const body: Record<string, unknown> = {
        branchId,
        partyId,
        partyName: partyId ? undefined : partySearch || undefined,
        date,
        dueDate: dueDate || undefined,
        description: description || undefined,
        payments,
        sourceTxnId: sourceTxn?.id,
      };

      if (meta.hasLines) {
        body.lines = lines
          .filter((l) => (l.itemId || l.name) && Number(l.quantity) > 0)
          .map((l) => ({
            itemId: l.itemId,
            name: l.name || undefined,
            hsnCode: l.hsnCode,
            quantity: Number(l.quantity),
            unit: l.unit,
            unitPrice: Number(l.unitPrice) || 0,
            // Send EITHER a percentage OR a rupee amount — txn-core reads discountAmount only
            // when discountPercent is absent.
            discountPercent: l.discountType === 'PCT' && l.discountValue ? Number(l.discountValue) : undefined,
            discountAmount: l.discountType === 'AMT' && l.discountValue
              ? Math.min(Number(l.discountValue), (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))
              : undefined,
            taxRate: Number(l.taxRate) || 0,
          }));
        // Bill-level discount: send EITHER a percentage OR a fixed amount (never both, so the
        // backend's computeTotals uses the right one).
        if (billDiscountType === 'AMT') {
          body.discountAmount = billDiscountPct ? Number(billDiscountPct) : undefined;
          body.discountPercent = undefined;
        } else {
          body.discountPercent = billDiscountPct ? Number(billDiscountPct) : undefined;
          body.discountAmount = undefined;
        }
        body.additionalCharges = Number(shipping) > 0 ? [{ name: 'Shipping', amount: Number(shipping) }] : undefined;
        body.roundOffEnabled = roundOffEnabled;
      } else {
        body.amount = effectiveTotal;
        if (isExpense) body.expenseCategoryId = expenseCategoryId || undefined;
      }

      if (sourceTxn && meta.convertEndpoint) {
        return api<Txn>(meta.convertEndpoint(sourceTxn.id), { method: 'POST', token, body: JSON.stringify(body) });
      }
      return api<Txn>(meta.createEndpoint, { method: 'POST', token, body: JSON.stringify(body) });
    },
    onSuccess: (txn) => {
      setShowPreview(false);
      toast.success(`${meta.label} ${txn.txnNumber} saved`);
      queryClient.invalidateQueries();
      router.push(meta.listPath);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const validate = () => {
    if (isPayment && !partyId && txnType === 'PAYMENT_IN') { toast.error('Select a party'); return false; }
    if (isExpense && !expenseCategoryId) { toast.error('Select an expense category'); return false; }
    // An expense without a payee can't be traced back to anyone when the books are reviewed.
    if (isExpense && !partyId && !partySearch.trim()) { toast.error('Enter who this expense was paid to'); return false; }
    if (meta.hasLines && !lines.some((l) => (l.itemId || l.name) && Number(l.quantity) > 0)) {
      toast.error('Add at least one item'); return false;
    }
    if (!meta.hasLines && effectiveTotal <= 0) { toast.error('Enter an amount'); return false; }
    if (txnType === 'PURCHASE_BILL' && !partyId) { toast.error('Select a supplier'); return false; }
    return true;
  };

  const updateLine = (key: number, patch: Partial<FormLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const pickItem = (lineKeyId: number, item: Item) => {
    const price = meta.side === 'purchase' ? item.purchasePrice : item.salePrice;
    updateLine(lineKeyId, {
      itemId: item.id,
      // Fold size into the stored line name so it prints on the bill (no line schema change).
      name: item.size ? `${item.name} (${item.size})` : item.name,
      hsnCode: item.hsnCode ?? undefined,
      unit: item.baseUnit,
      unitPrice: String(Number(price)),
      taxRate: String(Number(item.taxRate)),
    });
    setActiveItemRow(null);
    setItemSearch('');
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Party + dates */}
      <div className="bg-white rounded-lg border shadow-sm p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative md:col-span-1">
          <label className="text-xs font-semibold text-muted-foreground">
            {meta.partyLabel}{isExpense && <span className="text-red-600"> *</span>}
          </label>
          <Input
            ref={partyInputRef}
            value={partySearch}
            placeholder={isExpense ? 'Who was this paid to?' : `Search ${meta.partyLabel.toLowerCase()}…`}
            onChange={(e) => { setPartySearch(e.target.value); setPartyId(undefined); setPartyOpen(true); }}
            onFocus={() => setPartyOpen(true)}
            onBlur={() => setTimeout(() => setPartyOpen(false), 150)}
          />
          <AutocompleteDropdown
            anchorEl={partyInputRef.current}
            open={partyOpen && filteredParties.length > 0}
            onClose={() => setPartyOpen(false)}
          >
            {filteredParties.map((p) => (
              <button
                key={p.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-red-50 text-sm flex justify-between gap-2"
                onMouseDown={() => { setPartyId(p.id); setPartySearch(p.name); setPartyOpen(false); }}
              >
                <span className="truncate">{p.name}</span>
                <span className={cn('text-xs shrink-0', Number(p.currentBalance) >= 0 ? 'text-green-600' : 'text-red-600')}>
                  {formatMoney(Math.abs(Number(p.currentBalance)))}
                </span>
              </button>
            ))}
          </AutocompleteDropdown>
          {selectedParty && (
            <p className="text-xs mt-1 text-muted-foreground">
              Balance:{' '}
              <span className={Number(selectedParty.currentBalance) >= 0 ? 'text-green-600' : 'text-red-600'}>
                {formatMoney(Math.abs(Number(selectedParty.currentBalance)))}
                {Number(selectedParty.currentBalance) >= 0 ? ' (to receive)' : ' (to pay)'}
              </span>
            </p>
          )}
        </div>
        {isExpense && (
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Expense Category</label>
            {addingExpenseCategory ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="w-full h-10 rounded-md border px-3 text-sm bg-white"
                  value={newExpenseCategory}
                  onChange={(e) => setNewExpenseCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addExpenseCategory(); }
                    if (e.key === 'Escape') { setAddingExpenseCategory(false); setNewExpenseCategory(''); }
                  }}
                  placeholder="New expense category name"
                />
                <button type="button" onClick={addExpenseCategory} className="shrink-0 rounded-md border px-3 text-sm font-medium text-white bg-primary hover:bg-primary/90">Add</button>
                <button type="button" onClick={() => { setAddingExpenseCategory(false); setNewExpenseCategory(''); }} title="Cancel" className="shrink-0 rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted">✕</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  className="w-full min-w-0 h-10 rounded-md border px-3 text-sm bg-white"
                  value={expenseCategoryId}
                  onChange={(e) => setExpenseCategoryId(e.target.value)}
                >
                  <option value="">Select category…</option>
                  {(expenseCategories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" onClick={() => setAddingExpenseCategory(true)} title="Add category" className="shrink-0 rounded-md border px-3 text-sm font-medium text-primary hover:bg-primary/5">+ New</button>
              </div>
            )}
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Date</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {(txnType === 'SALE_INVOICE' || txnType === 'PURCHASE_BILL' || meta.isOrder) && (
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              {meta.isOrder ? 'Due / Delivery Date' : 'Due Date'}
            </label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        )}
      </div>

      {/* Item lines */}
      {meta.hasLines && (
        <div className="bg-white rounded-lg border shadow-sm">
          {/* The item autocomplete is portalled to <body>, so this scroller can't clip it. */}
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="bg-red-50 text-red-900 text-xs">
                <th className="px-2 py-2 text-left w-8">#</th>
                <th className="px-2 py-2 text-left">ITEM</th>
                <th className="px-2 py-2 text-right w-20">QTY</th>
                <th className="px-2 py-2 text-left w-20">UNIT</th>
                <th className="px-2 py-2 text-right w-28">PRICE/UNIT</th>
                <th className="px-2 py-2 text-right w-32">DISCOUNT</th>
                <th className="px-2 py-2 text-right w-20">TAX %</th>
                <th className="px-2 py-2 text-right w-28">AMOUNT</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const qty = Number(l.quantity) || 0;
                const gross = qty * (Number(l.unitPrice) || 0);
                const disc = lineDiscount(l, gross);
                const lineTotal = (gross - disc) * (1 + (Number(l.taxRate) || 0) / 100);
                return (
                  <tr key={l.key} className="border-t align-top">
                    <td className="px-2 py-1.5 text-muted-foreground">{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <Input
                        ref={(el) => { if (el) itemInputRefs.current.set(l.key, el); else itemInputRefs.current.delete(l.key); }}
                        className="h-9"
                        value={activeItemRow === l.key ? itemSearch : l.name}
                        placeholder="Search item…"
                        // Escape closes the list by clearing activeItemRow; typing or clicking the
                        // field re-opens it. Without that the row stays dead until the input is
                        // blurred and re-focused (onFocus can't re-fire on a focused element),
                        // so the cashier ends up saving free text with no itemId.
                        onChange={(e) => { setActiveItemRow(l.key); setItemSearch(e.target.value); updateLine(l.key, { name: e.target.value, itemId: undefined }); }}
                        onFocus={() => { setActiveItemRow(l.key); setItemSearch(l.name); }}
                        onClick={() => setActiveItemRow((r) => (r === l.key ? r : l.key))}
                        onBlur={() => setTimeout(() => setActiveItemRow((r) => (r === l.key ? null : r)), 150)}
                      />
                      <AutocompleteDropdown
                        anchorEl={itemInputRefs.current.get(l.key) ?? null}
                        open={activeItemRow === l.key && filteredItems.length > 0}
                        minWidth={288}
                        onClose={() => setActiveItemRow((r) => (r === l.key ? null : r))}
                      >
                        {filteredItems.map((it) => (
                          <button
                            key={it.id}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-red-50 text-sm"
                            onMouseDown={() => pickItem(l.key, it)}
                          >
                            <div className="flex justify-between gap-2">
                              <span className="font-medium truncate">{it.name}{it.size ? ` · ${it.size}` : ''}</span>
                              <span className="shrink-0">{formatMoney(meta.side === 'purchase' ? it.purchasePrice : it.salePrice)}</span>
                            </div>
                            <div className="text-xs text-muted-foreground flex justify-between gap-2">
                              <span className="truncate">{it.sku}{it.size ? ` · Size ${it.size}` : ''}</span>
                              {it.itemType === 'PRODUCT' && <span className="shrink-0">Stock: {Number(it.currentStock)}</span>}
                            </div>
                          </button>
                        ))}
                      </AutocompleteDropdown>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-9 text-right" type="number" min="0" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-9" value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-9 text-right" type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-stretch">
                        {/* min-w-0: as a flex item the input's automatic minimum size is its
                            intrinsic ~180px, which forced this column ~100px past the w-32 the
                            header asks for and made the whole table that much wider. */}
                        <Input
                          className="h-9 text-right rounded-r-none min-w-0"
                          type="number"
                          min="0"
                          max={l.discountType === 'PCT' ? 100 : undefined}
                          step="0.01"
                          placeholder={l.discountType === 'PCT' ? '%' : '₹'}
                          value={l.discountValue}
                          onChange={(e) => updateLine(l.key, { discountValue: e.target.value })}
                        />
                        <button
                          type="button"
                          title={l.discountType === 'PCT' ? 'Switch to a discount in ₹' : 'Switch to a discount in %'}
                          className="shrink-0 w-9 rounded-r-md border border-l-0 bg-muted/60 text-xs font-semibold hover:bg-muted"
                          onClick={() => updateLine(l.key, { discountType: l.discountType === 'PCT' ? 'AMT' : 'PCT' })}
                        >
                          {l.discountType === 'PCT' ? '%' : '₹'}
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-9 text-right" type="number" min="0" value={l.taxRate} onChange={(e) => updateLine(l.key, { taxRate: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium pt-3">{formatMoney(lineTotal)}</td>
                    <td className="px-1 py-1.5">
                      <button type="button" className="p-2 text-muted-foreground hover:text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="p-2 border-t">
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              <Plus className="h-4 w-4 mr-1" /> Add Row
            </Button>
          </div>
        </div>
      )}

      {/* Amount (payments / expense without lines) */}
      {!meta.hasLines && (
        <div className="bg-white rounded-lg border shadow-sm p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Amount</label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
        </div>
      )}

      {/* Payment + totals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
          <p className="text-sm font-semibold">Payment</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Payment Type</label>
              <select className="w-full h-10 rounded-md border px-3 text-sm bg-white" value={paymentType} onChange={(e) => setPaymentType(e.target.value)} disabled={creditSale}>
                {PAYMENT_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Account</label>
              {/* min-w-0 — a select is as wide as its widest option unless told otherwise, so a
                  long bank-account name would push this grid past a phone's width. */}
              <select className="w-full min-w-0 h-10 rounded-md border px-3 text-sm bg-white" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} disabled={creditSale || paymentType === 'CHEQUE'}>
                <option value="">Auto ({paymentType === 'CASH' ? 'Cash In Hand' : 'First Bank A/c'})</option>
                {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          {meta.hasLines && !meta.isOrder && meta.side !== 'other' && (
            <>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">{meta.paymentLabel} Now</label>
                <Input
                  type="number" min="0" step="0.01"
                  value={creditSale ? '0' : paidNow}
                  placeholder={String(effectiveTotal.toFixed(2))}
                  disabled={creditSale}
                  onChange={(e) => setPaidNow(e.target.value)}
                />
              </div>
              {partyId && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={creditSale} onChange={(e) => setCreditSale(e.target.checked)} />
                  Full credit ({meta.side === 'sale' ? 'customer pays later' : 'pay supplier later'})
                </label>
              )}
              {balance > 0 && (
                <p className="text-xs text-amber-600">
                  Balance {formatMoney(balance)} will be {meta.side === 'sale' ? 'receivable from' : 'payable to'} {partySearch || 'party'}
                </p>
              )}
            </>
          )}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notes…" />
          </div>
        </div>

        <div className="bg-white rounded-lg border shadow-sm p-4 space-y-2 text-sm">
          <p className="text-sm font-semibold mb-2">Totals</p>
          {meta.hasLines ? (
            <>
              {totals.itemDiscount > 0 && (
                <div className="flex justify-between text-emerald-700"><span className="text-muted-foreground">Item Discount</span><span>-{formatMoney(totals.itemDiscount)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal (after item disc.)</span><span>{formatMoney(totals.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{formatMoney(totals.tax)}</span></div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted-foreground flex items-center gap-2 flex-wrap">
                  Bill Discount
                  {totals.billDiscount > 0 && <span className="text-emerald-700 font-medium">-{formatMoney(totals.billDiscount)}</span>}
                </span>
                <div className="flex items-center gap-1">
                  <div className="flex rounded-md border overflow-hidden text-xs">
                    <button
                      type="button"
                      className={cn('px-2 py-1.5', billDiscountType === 'PCT' ? 'bg-primary text-primary-foreground' : 'bg-background')}
                      onClick={() => setBillDiscountType('PCT')}
                    >%</button>
                    <button
                      type="button"
                      className={cn('px-2 py-1.5', billDiscountType === 'AMT' ? 'bg-primary text-primary-foreground' : 'bg-background')}
                      onClick={() => setBillDiscountType('AMT')}
                    >₹</button>
                  </div>
                  <Input
                    className="h-8 w-20 text-right"
                    type="number"
                    min="0"
                    max={billDiscountType === 'PCT' ? 100 : undefined}
                    placeholder={billDiscountType === 'PCT' ? '%' : '₹'}
                    value={billDiscountPct}
                    onChange={(e) => setBillDiscountPct(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Shipping / Charges</span>
                <Input className="h-8 w-24 text-right" type="number" min="0" value={shipping} onChange={(e) => setShipping(e.target.value)} />
              </div>
              <label className="flex items-center justify-between text-muted-foreground">
                <span>Round Off {totals.roundOff !== 0 && `(${totals.roundOff > 0 ? '+' : ''}${totals.roundOff.toFixed(2)})`}</span>
                <input type="checkbox" checked={roundOffEnabled} onChange={(e) => setRoundOffEnabled(e.target.checked)} />
              </label>
            </>
          ) : null}
          <div className="flex justify-between border-t pt-2 text-base font-bold">
            <span>Total</span><span>{formatMoney(effectiveTotal)}</span>
          </div>
          {meta.hasLines && !meta.isOrder && meta.side !== 'other' && (
            <>
              <div className="flex justify-between text-green-700"><span>{meta.paymentLabel}</span><span>{formatMoney(received)}</span></div>
              <div className="flex justify-between text-red-600 font-semibold"><span>Balance</span><span>{formatMoney(balance)}</span></div>
            </>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pb-8">
        <Button variant="outline" onClick={() => router.push(meta.listPath)}>Cancel</Button>
        <Button
          className="bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)]"
          disabled={saveMutation.isPending}
          onClick={() => { if (validate()) setShowPreview(true); }}
        >
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending ? 'Saving…' : `Save ${meta.label}`}
        </Button>
      </div>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm {meta.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {(partyId || partySearch) && (
              <div className="flex justify-between"><span className="text-muted-foreground">{meta.partyLabel}</span><span className="font-medium">{selectedParty?.name ?? partySearch}</span></div>
            )}
            {meta.hasLines && (
              <div className="max-h-56 overflow-y-auto divide-y border-t border-b">
                {lines.filter((l) => (l.itemId || l.name) && Number(l.quantity) > 0).map((l) => (
                  <div key={l.key} className="flex justify-between py-1.5">
                    <span className="truncate pr-2">{l.name} <span className="text-muted-foreground">x{l.quantity}</span></span>
                    <span className="shrink-0">{formatMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between text-base font-bold pt-1">
              <span>Total</span><span>{formatMoney(effectiveTotal)}</span>
            </div>
            {meta.hasLines && !meta.isOrder && meta.side !== 'other' && (
              <div className="flex justify-between text-red-600"><span>Balance</span><span>{formatMoney(balance)}</span></div>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowPreview(false)}>Back</Button>
            <Button
              className="flex-1 bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)]"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : 'Confirm & Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PrintButton({ txnId }: { txnId: string }) {
  const token = useAuthStore((s) => s.accessToken);
  return (
    <Button
      variant="outline" size="sm"
      onClick={async () => {
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/v1/receipts/${txnId}/pdf`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) throw new Error('Failed to generate receipt');
          const blob = await res.blob();
          if (!window.open(URL.createObjectURL(blob), '_blank')) {
            toast.error('Enable pop-ups for this site to print');
          }
        } catch {
          toast.error('Failed to print receipt');
        }
      }}
    >
      <Printer className="h-4 w-4" />
    </Button>
  );
}
