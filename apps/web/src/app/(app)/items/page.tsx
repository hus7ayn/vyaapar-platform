'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Barcode, Package, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VyaparStatCard } from '@/components/vyapar/stat-card';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney, TXN_META, TXN_STATUS_LABELS, TxnType } from '@/lib/txn-meta';
import { printBarcodeTags } from '@/lib/print-tags';

type ItemType = 'PRODUCT' | 'SERVICE';

interface Item {
  id: string;
  name: string;
  itemType: ItemType;
  sku: string;
  barcode?: string | null;
  size?: string | null;
  hsnCode?: string | null;
  description?: string | null;
  salePrice: string | number;
  salePriceTaxInclusive: boolean;
  purchasePrice: string | number;
  purchasePriceTaxInclusive: boolean;
  costPrice: string | number;
  wholesalePrice?: string | number | null;
  wholesaleMinQty?: string | number | null;
  mrp?: string | number | null;
  taxRate: string | number;
  baseUnit: string;
  secondaryUnit?: string | null;
  conversionRate?: string | number | null;
  openingStock: string | number;
  currentStock: string | number;
  minStock?: string | number | null;
  location?: string | null;
  trackStock: boolean;
  isActive: boolean;
  category?: { id: string; name: string } | null;
  variants: unknown[];
}

interface Adjustment {
  id: string;
  adjType: 'ADD' | 'REDUCE';
  quantity: string | number;
  atPrice?: string | number | null;
  details?: string | null;
  date: string;
}

interface ItemDetail extends Item {
  adjustments: Adjustment[];
}

interface ItemsSummary {
  itemCount: number;
  stockValue: number;
  lowStockCount: number;
}

interface ItemTxnLine {
  id: string;
  name: string;
  quantity: string | number;
  unit: string;
  unitPrice: string | number;
  total: string | number;
  txn: { id: string; txnType: TxnType; txnNumber: string; date: string; partyName?: string | null; status: string };
}

interface Unit {
  id: string;
  name: string;
  shortName: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
}

function decodeBarcodeCost(barcode?: string | null): number | null {
  if (!barcode) return null;
  const digits = barcode.replace(/\D/g, '');
  if (digits.length < 5) return null;
  const paise = Number(digits.slice(-5));
  return Number.isNaN(paise) ? null : paise / 100;
}

interface ItemForm {
  name: string;
  itemType: ItemType;
  categoryId: string;
  sku: string;
  barcode: string;
  size: string;
  hsnCode: string;
  salePrice: string;
  purchasePrice: string;
  costPrice: string;
  wholesalePrice: string;
  wholesaleMinQty: string;
  mrp: string;
  taxRate: string;
  baseUnit: string;
  openingStock: string;
  minStock: string;
  location: string;
}

const EMPTY_FORM: ItemForm = {
  name: '',
  itemType: 'PRODUCT',
  categoryId: '',
  sku: '',
  barcode: '',
  size: '',
  hsnCode: '',
  salePrice: '',
  purchasePrice: '',
  costPrice: '',
  wholesalePrice: '',
  wholesaleMinQty: '',
  mrp: '',
  taxRate: '',
  baseUnit: '',
  openingStock: '',
  minStock: '',
  location: '',
};

interface AdjustForm {
  adjType: 'ADD' | 'REDUCE';
  quantity: string;
  atPrice: string;
  details: string;
  date: string;
}

const EMPTY_ADJUST: AdjustForm = { adjType: 'ADD', quantity: '', atPrice: '', details: '', date: '' };

function isLowStock(item: Item) {
  return item.itemType === 'PRODUCT' && item.minStock != null && Number(item.currentStock) <= Number(item.minStock);
}

export default function ItemsPage() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken) ?? undefined;

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'PRODUCT' | 'SERVICE'>('ALL');
  const [sizeFilter, setSizeFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'transactions' | 'adjustments'>('transactions');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState<AdjustForm>(EMPTY_ADJUST);

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  const listQs = new URLSearchParams();
  if (search) listQs.set('search', search);
  if (typeFilter !== 'ALL') listQs.set('type', typeFilter);
  if (sizeFilter) listQs.set('size', sizeFilter);

  const { data: items, isLoading } = useQuery({
    queryKey: ['items', search, typeFilter, sizeFilter],
    queryFn: () => api<Item[]>(`/items?${listQs.toString()}`, { token }),
    enabled: !!token,
  });

  const { data: summary } = useQuery({
    queryKey: ['items-summary'],
    queryFn: () => api<ItemsSummary>('/items/summary', { token }),
    enabled: !!token,
  });

  const { data: selected } = useQuery({
    queryKey: ['item', selectedId],
    queryFn: () => api<ItemDetail>(`/items/${selectedId}`, { token }),
    enabled: !!token && !!selectedId,
  });

  const { data: itemTxns, isLoading: txnsLoading } = useQuery({
    queryKey: ['item-txns', selectedId],
    queryFn: () => api<ItemTxnLine[]>(`/items/${selectedId}/transactions`, { token }),
    enabled: !!token && !!selectedId && detailTab === 'transactions',
  });

  const { data: units } = useQuery({
    queryKey: ['item-units'],
    queryFn: () => api<Unit[]>('/items/units', { token }),
    enabled: !!token && dialogOpen,
  });

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories', { token }),
    enabled: !!token && dialogOpen,
  });

  const invalidateItems = () => {
    queryClient.invalidateQueries({ queryKey: ['items'] });
    queryClient.invalidateQueries({ queryKey: ['items-summary'] });
    queryClient.invalidateQueries({ queryKey: ['item'] });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const num = (v: string) => (v === '' ? undefined : Number(v));
      const isService = form.itemType === 'SERVICE';
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        itemType: form.itemType,
        categoryId: form.categoryId || undefined,
        sku: form.sku || undefined,
        barcode: editingItem ? (form.barcode.trim() || null) : (form.barcode || undefined),
        size: form.size.trim() || (editingItem ? null : undefined),
        hsnCode: form.hsnCode || undefined,
        salePrice: num(form.salePrice),
        purchasePrice: num(form.purchasePrice),
        costPrice: num(form.costPrice) ?? num(form.purchasePrice),
        wholesalePrice: num(form.wholesalePrice),
        wholesaleMinQty: num(form.wholesaleMinQty),
        mrp: num(form.mrp),
        taxRate: num(form.taxRate),
        baseUnit: form.baseUnit || undefined,
        ...(isService
          ? { trackStock: false }
          : {
              openingStock: editingItem ? undefined : num(form.openingStock),
              minStock: num(form.minStock),
              location: form.location || undefined,
            }),
      };
      return editingItem
        ? api(`/items/${editingItem.id}`, { method: 'PATCH', token, body: JSON.stringify(body) })
        : api('/items', { method: 'POST', token, body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success(editingItem ? 'Item updated' : 'Item created');
      setDialogOpen(false);
      invalidateItems();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/items/${id}`, { method: 'DELETE', token }),
    onSuccess: () => {
      toast.success('Item deleted');
      setSelectedId(null);
      invalidateItems();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adjustMutation = useMutation({
    mutationFn: () =>
      api(`/items/${selectedId}/adjust`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          adjType: adjustForm.adjType,
          quantity: Number(adjustForm.quantity),
          atPrice: adjustForm.atPrice ? Number(adjustForm.atPrice) : undefined,
          details: adjustForm.details || undefined,
          date: adjustForm.date || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success('Stock adjusted');
      setAdjustOpen(false);
      invalidateItems();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const barcodeMutation = useMutation({
    mutationFn: () => api(`/items/${selectedId}/assign-barcode`, { method: 'POST', token, body: JSON.stringify({}) }),
    onSuccess: () => {
      toast.success('Barcode assigned');
      invalidateItems();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (i: Item) => {
    setEditingItem(i);
    setForm({
      name: i.name,
      itemType: i.itemType,
      categoryId: i.category?.id ?? '',
      sku: i.sku ?? '',
      barcode: i.barcode ?? '',
      size: i.size ?? '',
      hsnCode: i.hsnCode ?? '',
      salePrice: String(i.salePrice ?? ''),
      purchasePrice: String(i.purchasePrice ?? ''),
      costPrice: String((i as Item & { costPrice?: string | number }).costPrice ?? i.purchasePrice ?? ''),
      wholesalePrice: i.wholesalePrice != null ? String(i.wholesalePrice) : '',
      wholesaleMinQty: i.wholesaleMinQty != null ? String(i.wholesaleMinQty) : '',
      mrp: i.mrp != null ? String(i.mrp) : '',
      taxRate: String(i.taxRate ?? ''),
      baseUnit: i.baseUnit ?? '',
      openingStock: '',
      minStock: i.minStock != null ? String(i.minStock) : '',
      location: i.location ?? '',
    });
    setDialogOpen(true);
  };

  const list = items ?? [];
  const set = (patch: Partial<ItemForm>) => setForm((f) => ({ ...f, ...patch }));

  const addCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    try {
      const cat = await api<Category>('/categories', { method: 'POST', token, body: JSON.stringify({ name }) });
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
      set({ categoryId: cat.id });
      setNewCategory('');
      setAddingCategory(false);
      toast.success('Category added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add category');
    }
  };
  const isService = form.itemType === 'SERVICE';
  const fieldCls = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  // Required fields when ADDING a new item (edits stay lenient so legacy items
  // without these fields can still be updated). Services skip stock/barcode.
  const validateNewItem = (): string | null => {
    if (!form.name.trim()) return 'Item name is required';
    if (!form.categoryId) return 'Please select a category';
    if (form.salePrice.trim() === '') return 'Sale price is required';
    if (form.costPrice.trim() === '') return 'Cost price is required';
    if (!form.baseUnit.trim()) return 'Please select a unit';
    if (!isService) {
      if (form.openingStock.trim() === '') return 'Opening stock (no. of products) is required';
      if (!form.barcode.trim()) return 'Barcode is required';
    }
    return null;
  };

  return (
    <div className="p-4 lg:p-6 flex gap-4 items-start">
      {/* LEFT pane */}
      <div className="w-80 shrink-0 bg-white rounded-lg border shadow-sm flex flex-col max-h-[calc(100vh-7rem)]">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-bold">Items</h1>
            <Button size="sm" className="bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)]" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Add Item
            </Button>
          </div>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {([
              { value: 'ALL', label: 'All' },
              { value: 'PRODUCT', label: 'Products' },
              { value: 'SERVICE', label: 'Services' },
            ] as const).map((t) => (
              <button
                key={t.value}
                className={cn(
                  'flex-1 text-xs font-medium rounded-md py-1.5 transition-colors',
                  typeFilter === t.value ? 'bg-[hsl(348,85%,52%)] text-white' : 'bg-slate-100 text-muted-foreground hover:bg-slate-200',
                )}
                onClick={() => setTypeFilter(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            className="text-xs rounded-md border px-2 py-1.5 bg-white"
            value={sizeFilter}
            onChange={(e) => setSizeFilter(e.target.value)}
            title="Filter by size"
          >
            <option value="">All sizes</option>
            {['S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40'].map((s) => (
              <option key={s} value={s}>Size {s}</option>
            ))}
          </select>
        </div>
        <div className="overflow-y-auto flex-1">
          {isLoading && <p className="text-center py-8 text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && list.length === 0 && (
            <p className="text-center py-8 text-sm text-muted-foreground">No items found</p>
          )}
          {list.map((i) => (
            <button
              key={i.id}
              className={cn(
                'w-full text-left px-3 py-2.5 border-b last:border-0 flex items-center justify-between gap-2 hover:bg-red-50/40 transition-colors',
                selectedId === i.id && 'bg-red-50',
              )}
              onClick={() => { setSelectedId(i.id); setDetailTab('transactions'); }}
            >
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{i.name}</p>
                {i.itemType === 'PRODUCT' ? (
                  <p className={cn('text-xs', isLowStock(i) ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
                    Stock: {Number(i.currentStock)} {i.baseUnit}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Service</p>
                )}
              </div>
              <span className="text-xs font-semibold shrink-0">{formatMoney(i.salePrice)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT pane */}
      <div className="flex-1 min-w-0 space-y-4">
        {!selectedId && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <VyaparStatCard label="Items" value={String(summary?.itemCount ?? 0)} icon={<Package className="h-4 w-4 text-muted-foreground" />} />
              <VyaparStatCard label="Stock Value" value={formatMoney(summary?.stockValue ?? 0)} color="border-l-green-500" />
              <VyaparStatCard label="Low Stock" value={String(summary?.lowStockCount ?? 0)} color="border-l-amber-500" icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} />
            </div>
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <div className="p-3 border-b">
                <p className="font-semibold text-sm">All Items</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b bg-slate-50">
                    <th className="px-3 py-2 text-left">NAME</th>
                    <th className="px-3 py-2 text-left">SKU</th>
                    <th className="px-3 py-2 text-left">SIZE</th>
                    <th className="px-3 py-2 text-left">BARCODE</th>
                    <th className="px-3 py-2 text-right">SALE</th>
                    <th className="px-3 py-2 text-right">COST</th>
                    <th className="px-3 py-2 text-right">PURCHASE</th>
                    <th className="px-3 py-2 text-right">STOCK</th>
                    <th className="px-3 py-2 text-right">VALUE</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">Loading…</td></tr>
                  )}
                  {!isLoading && list.length === 0 && (
                    <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">No items yet. Add your first item to get started.</td></tr>
                  )}
                  {list.map((i) => {
                    const cost = Number(i.costPrice) || Number(i.purchasePrice);
                    return (
                    <tr key={i.id} className="border-b last:border-0 hover:bg-red-50/40 cursor-pointer" onClick={() => setSelectedId(i.id)}>
                      <td className="px-3 py-2 font-medium">{i.name}</td>
                      <td className="px-3 py-2">{i.sku || '—'}</td>
                      <td className="px-3 py-2">{i.size || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{i.barcode ?? '—'}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(i.salePrice)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(cost)}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(i.purchasePrice)}</td>
                      <td className={cn('px-3 py-2 text-right', isLowStock(i) && 'text-red-600 font-semibold')}>
                        {i.itemType === 'PRODUCT' ? `${Number(i.currentStock)} ${i.baseUnit}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {i.itemType === 'PRODUCT' ? formatMoney(Number(i.currentStock) * cost) : '—'}
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          </>
        )}

        {selectedId && selected && (
          <>
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">{selected.name}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                      {selected.itemType === 'PRODUCT' ? 'Product' : 'Service'}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-0.5">
                    <p>SKU: {selected.sku || '—'}{selected.size ? ` · Size: ${selected.size}` : ''}</p>
                    {selected.category && <p>Category: {selected.category.name}</p>}
                    <p>Unit: {selected.baseUnit}{selected.hsnCode ? ` · HSN: ${selected.hsnCode}` : ''}</p>
                    {selected.location && <p>Location: {selected.location}</p>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm pt-1">
                    <span>Sale: <span className="font-semibold">{formatMoney(selected.salePrice)}</span></span>
                    <span>Cost: <span className="font-semibold">{formatMoney(selected.costPrice || selected.purchasePrice)}</span></span>
                    <span>Purchase: <span className="font-semibold">{formatMoney(selected.purchasePrice)}</span></span>
                    {selected.wholesalePrice != null && (
                      <span>Wholesale: <span className="font-semibold">{formatMoney(selected.wholesalePrice)}</span>{selected.wholesaleMinQty != null ? ` (min ${Number(selected.wholesaleMinQty)})` : ''}</span>
                    )}
                    {selected.mrp != null && <span>MRP: <span className="font-semibold">{formatMoney(selected.mrp)}</span></span>}
                    <span>Tax: <span className="font-semibold">{Number(selected.taxRate)}%</span></span>
                  </div>
                </div>
                <div className="text-right space-y-2">
                  {selected.itemType === 'PRODUCT' && (
                    <div>
                      <p className="text-xs text-muted-foreground">Current Stock</p>
                      <p className={cn('text-2xl font-bold', isLowStock(selected) ? 'text-red-600' : '')}>
                        {Number(selected.currentStock)} {selected.baseUnit}
                      </p>
                      {selected.minStock != null && (
                        <p className="text-xs text-muted-foreground">Min stock: {Number(selected.minStock)}</p>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2 justify-end flex-wrap">
                    {selected.itemType === 'PRODUCT' && (
                      <Button
                        variant="outline" size="sm"
                        onClick={() => { setAdjustForm(EMPTY_ADJUST); setAdjustOpen(true); }}
                      >
                        <SlidersHorizontal className="h-4 w-4 mr-1" /> Adjust Stock
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openEdit(selected)}>
                      <Pencil className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="outline" size="sm" className="text-red-600 hover:text-red-700"
                      disabled={deleteMutation.isPending}
                      onClick={() => { if (confirm(`Delete ${selected.name}?`)) deleteMutation.mutate(selected.id); }}
                    >
                      <Trash2 className="h-4 w-4 mr-1" /> Delete
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <BarcodeTagPanel
              itemId={selected.id}
              barcode={selected.barcode}
              costPrice={Number(selected.costPrice) || Number(selected.purchasePrice)}
              name={selected.name}
              price={Number(selected.mrp) || Number(selected.salePrice)}
              category={selected.category?.name ?? null}
              sku={selected.sku}
              mrp={selected.mrp != null ? Number(selected.mrp) : null}
              token={token}
              onGenerate={() => barcodeMutation.mutate()}
              onEdit={() => openEdit(selected)}
              generating={barcodeMutation.isPending}
            />

            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <div className="border-b flex">
                {([
                  { value: 'transactions', label: 'Transactions' },
                  { value: 'adjustments', label: 'Stock Adjustments' },
                ] as const).map((t) => (
                  <button
                    key={t.value}
                    className={cn(
                      'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                      detailTab === t.value
                        ? 'border-[hsl(348,85%,52%)] text-[hsl(348,85%,52%)]'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setDetailTab(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {detailTab === 'transactions' && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b bg-slate-50">
                      <th className="px-3 py-2 text-left">DATE</th>
                      <th className="px-3 py-2 text-left">TYPE</th>
                      <th className="px-3 py-2 text-left">NUMBER</th>
                      <th className="px-3 py-2 text-left">PARTY</th>
                      <th className="px-3 py-2 text-right">QTY</th>
                      <th className="px-3 py-2 text-right">PRICE</th>
                      <th className="px-3 py-2 text-right">TOTAL</th>
                      <th className="px-3 py-2 text-center">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txnsLoading && (
                      <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
                    )}
                    {!txnsLoading && !(itemTxns ?? []).length && (
                      <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">No transactions for this item yet</td></tr>
                    )}
                    {(itemTxns ?? []).map((l) => {
                      const meta = TXN_META[l.txn.txnType];
                      const status = TXN_STATUS_LABELS[l.txn.status] ?? { label: l.txn.status, className: 'bg-gray-100 text-gray-600' };
                      return (
                        <tr key={l.id} className="border-b last:border-0 hover:bg-red-50/40">
                          <td className="px-3 py-2">{formatDate(l.txn.date)}</td>
                          <td className="px-3 py-2">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', meta?.color ?? 'bg-gray-50 text-gray-600')}>
                              {meta?.label ?? l.txn.txnType}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-medium">{l.txn.txnNumber}</td>
                          <td className="px-3 py-2">{l.txn.partyName ?? '—'}</td>
                          <td className="px-3 py-2 text-right">{Number(l.quantity)} {l.unit}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(l.unitPrice)}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatMoney(l.total)}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', status.className)}>{status.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {detailTab === 'adjustments' && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b bg-slate-50">
                      <th className="px-3 py-2 text-left">DATE</th>
                      <th className="px-3 py-2 text-left">TYPE</th>
                      <th className="px-3 py-2 text-right">QUANTITY</th>
                      <th className="px-3 py-2 text-right">AT PRICE</th>
                      <th className="px-3 py-2 text-left">DETAILS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!(selected.adjustments ?? []).length && (
                      <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No stock adjustments yet</td></tr>
                    )}
                    {(selected.adjustments ?? []).map((a) => (
                      <tr key={a.id} className="border-b last:border-0 hover:bg-red-50/40">
                        <td className="px-3 py-2">{formatDate(a.date)}</td>
                        <td className="px-3 py-2">
                          <span className={cn(
                            'text-xs px-2 py-0.5 rounded-full font-medium',
                            a.adjType === 'ADD' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
                          )}>
                            {a.adjType === 'ADD' ? 'Added' : 'Reduced'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{Number(a.quantity)} {selected.baseUnit}</td>
                        <td className="px-3 py-2 text-right">{a.atPrice != null ? formatMoney(a.atPrice) : '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{a.details ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editingItem ? `Edit ${editingItem.name}` : 'Add Item'}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (editingItem) {
                if (!form.name.trim()) { toast.error('Item name is required'); return; }
              } else {
                const err = validateNewItem();
                if (err) { toast.error(err); return; }
              }
              saveMutation.mutate();
            }}
          >
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Basics</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Item Name *</label>
                  <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Basmati Rice 5kg" autoFocus />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Type</label>
                  <select className={fieldCls} value={form.itemType} onChange={(e) => set({ itemType: e.target.value as ItemType })}>
                    <option value="PRODUCT">Product</option>
                    <option value="SERVICE">Service</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Category{!editingItem && ' *'}</label>
                  {addingCategory ? (
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        className={fieldCls}
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); addCategory(); }
                          if (e.key === 'Escape') { setAddingCategory(false); setNewCategory(''); }
                        }}
                        placeholder="New category name"
                      />
                      <button type="button" onClick={addCategory} className="shrink-0 rounded-lg border px-3 text-sm font-medium text-white bg-primary hover:bg-primary/90">Add</button>
                      <button type="button" onClick={() => { setAddingCategory(false); setNewCategory(''); }} title="Cancel" className="shrink-0 rounded-lg border px-3 text-sm text-muted-foreground hover:bg-muted">✕</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <select className={fieldCls} value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                        <option value="">No category</option>
                        {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button type="button" onClick={() => setAddingCategory(true)} title="Add category" className="shrink-0 rounded-lg border px-3 text-sm font-medium text-primary hover:bg-primary/5">+ New</button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Item Code (SKU)</label>
                  <Input value={form.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="Auto-generated if empty" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Barcode (editable){!editingItem && !isService && ' *'}</label>
                  <Input value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} placeholder="13-digit; last 5 digits = cost in paise" />
                  <p className="text-[10px] text-muted-foreground mt-1">Last 5 digits encode cost price (e.g. 00150 = ₹1.50)</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">HSN Code</label>
                  <Input value={form.hsnCode} onChange={(e) => set({ hsnCode: e.target.value })} placeholder="HSN/SAC" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Size</label>
                  <Input value={form.size} onChange={(e) => set({ size: e.target.value })} placeholder="e.g. S, M, L, XL, 32" list="size-presets" />
                  <datalist id="size-presets">
                    {['S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40'].map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Pricing {isService ? '' : '& Stock'}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Sale Price{!editingItem && ' *'}</label>
                  <Input type="number" min="0" step="0.01" value={form.salePrice} onChange={(e) => set({ salePrice: e.target.value })} placeholder="0.00" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Cost Price{!editingItem && ' *'}</label>
                  <Input type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => set({ costPrice: e.target.value })} placeholder="Landed cost" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Purchase Price</label>
                  <Input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(e) => set({ purchasePrice: e.target.value })} placeholder="Supplier rate" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Wholesale Price</label>
                  <Input type="number" min="0" step="0.01" value={form.wholesalePrice} onChange={(e) => set({ wholesalePrice: e.target.value })} placeholder="Optional" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Wholesale Min Qty</label>
                  <Input type="number" min="0" step="1" value={form.wholesaleMinQty} onChange={(e) => set({ wholesaleMinQty: e.target.value })} placeholder="Optional" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">MRP</label>
                  <Input type="number" min="0" step="0.01" value={form.mrp} onChange={(e) => set({ mrp: e.target.value })} placeholder="Optional" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Tax Rate %</label>
                  <Input type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={(e) => set({ taxRate: e.target.value })} placeholder="e.g. 18" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Unit{!editingItem && ' *'}</label>
                  <select className={fieldCls} value={form.baseUnit} onChange={(e) => set({ baseUnit: e.target.value })}>
                    <option value="">Default</option>
                    {(units ?? []).map((u) => <option key={u.id} value={u.shortName}>{u.name} ({u.shortName})</option>)}
                  </select>
                </div>
                {!isService && (
                  <>
                    {!editingItem && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Opening Stock (no. of products) *</label>
                        <Input type="number" min="0" step="0.01" value={form.openingStock} onChange={(e) => set({ openingStock: e.target.value })} placeholder="0" />
                      </div>
                    )}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Min Stock (low-stock alert)</label>
                      <Input type="number" min="0" step="0.01" value={form.minStock} onChange={(e) => set({ minStock: e.target.value })} placeholder="Optional" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Location</label>
                      <Input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Shelf A-3" />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)]" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : editingItem ? 'Save Changes' : 'Create Item'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Adjust Stock dialog */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust Stock — {selected?.name}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!adjustForm.quantity || Number(adjustForm.quantity) <= 0) { toast.error('Enter a valid quantity'); return; }
              adjustMutation.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Adjustment</label>
                <select
                  className={fieldCls}
                  value={adjustForm.adjType}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, adjType: e.target.value as 'ADD' | 'REDUCE' }))}
                >
                  <option value="ADD">Add Stock</option>
                  <option value="REDUCE">Reduce Stock</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Quantity *</label>
                <Input
                  type="number" min="0" step="0.01" placeholder="0"
                  value={adjustForm.quantity}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">At Price</label>
                <Input
                  type="number" min="0" step="0.01" placeholder="Optional"
                  value={adjustForm.atPrice}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, atPrice: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Date</label>
                <Input
                  type="date"
                  value={adjustForm.date}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Details</label>
                <Input
                  placeholder="e.g. Damaged goods, stock count correction"
                  value={adjustForm.details}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, details: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)]" disabled={adjustMutation.isPending}>
                {adjustMutation.isPending ? 'Adjusting…' : 'Adjust Stock'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function BarcodeTagPanel({
  itemId,
  barcode,
  costPrice,
  name,
  price,
  category,
  sku,
  mrp,
  token,
  onGenerate,
  onEdit,
  generating,
}: {
  itemId: string;
  barcode?: string | null;
  costPrice: number;
  name: string;
  price: number;
  category?: string | null;
  sku?: string | null;
  mrp?: number | null;
  token?: string;
  onGenerate: () => void;
  onEdit: () => void;
  generating: boolean;
}) {
  const queryClient = useQueryClient();
  const [qty, setQty] = useState(2); // default to 2 slips per item; adjustable
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(barcode ?? '');

  useEffect(() => {
    if (!editing) setDraft(barcode ?? '');
  }, [barcode, editing]);

  const { data: image } = useQuery({
    queryKey: ['barcode-image', barcode],
    queryFn: () => api<{ dataUrl: string }>(`/items/barcode-image?text=${encodeURIComponent(barcode!)}`, { token }),
    enabled: !!token && !!barcode,
  });

  const saveBarcodeMutation = useMutation({
    mutationFn: (value: string) =>
      api(`/items/${itemId}`, { method: 'PATCH', token, body: JSON.stringify({ barcode: value.trim() || null }) }),
    onSuccess: () => {
      toast.success('Barcode updated');
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decoded = decodeBarcodeCost(barcode);

  return (
    <div className="bg-white rounded-lg border shadow-sm p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[220px]">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Barcode className="h-4 w-4" /> Barcode Tag
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Last 5 digits encode cost price in paise
            {decoded != null && <> · decoded: <span className="font-medium">{formatMoney(decoded)}</span></>}
            {decoded == null && costPrice > 0 && <> · expected suffix: <span className="font-mono">{String(Math.round(costPrice * 100)).padStart(5, '0')}</span></>}
          </p>
          {editing ? (
            <div className="flex items-center gap-2 mt-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Enter barcode value"
                className="h-8 font-mono text-sm w-48"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveBarcodeMutation.mutate(draft);
                  if (e.key === 'Escape') { setEditing(false); setDraft(barcode ?? ''); }
                }}
              />
              <Button size="sm" disabled={saveBarcodeMutation.isPending} onClick={() => saveBarcodeMutation.mutate(draft)}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(barcode ?? ''); }}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-2">
              {barcode ? (
                <p className="font-mono text-sm tracking-wider">{barcode}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No barcode assigned yet</p>
              )}
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditing(true)}>
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>Edit Item</Button>
          <Button variant="outline" size="sm" disabled={generating} onClick={onGenerate}>
            <Barcode className="h-3 w-3 mr-1" /> {barcode ? 'Regenerate' : 'Generate'}
          </Button>
        </div>
      </div>
      {image?.dataUrl && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="inline-block rounded border bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.dataUrl} alt={`Barcode ${barcode}`} className="h-16 max-w-full" />
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Qty</label>
              <Input
                type="number"
                min={1}
                max={200}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                className="w-20 h-9"
              />
            </div>
            <Button
              size="sm"
              onClick={() => printBarcodeTags([{ dataUrl: image.dataUrl, barcode: barcode!, name, price, qty, category, sku, mrp }])}
            >
              <Barcode className="h-3.5 w-3.5 mr-1" /> Print Tags
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
