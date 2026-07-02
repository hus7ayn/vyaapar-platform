'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search, Camera, Pause, Barcode, Package, AlertTriangle, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useVirtualizer } from '@tanstack/react-virtual';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatCurrency, cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { usePosStore, CartItem } from '@/stores/pos-store';
import { queueSyncOperation, findCachedProductByBarcode } from '@/lib/offline-db';
import { startSyncInterval } from '@/lib/sync-manager';
import { usePosCatalog, type PosProduct } from '@/hooks/use-pos-catalog';
import { CustomerPicker } from '@/components/pos/customer-picker';
import { HeldOrdersPanel } from '@/components/pos/held-orders-panel';
import { RecentOrdersPanel } from '@/components/pos/recent-orders-panel';
import { SplitPaymentDialog } from '@/components/pos/split-payment-dialog';
import { PosCartTable, PosLineEditDialog } from '@/components/pos/pos-cart-table';
import { PosBillFooter } from '@/components/pos/pos-bill-footer';
import { ReceiptActions } from '@/components/pos/receipt-actions';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const BarcodeScanner = dynamic(
  () => import('@/components/pos/barcode-scanner').then((m) => m.BarcodeScanner),
  { ssr: false },
);

type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'WALLET' | 'DEBT';

export default function PosPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const branchId = useAuthStore((s) => s.activeShopId) ?? undefined;
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const clientId = useRef(typeof crypto !== 'undefined' ? crypto.randomUUID() : 'client');
  const checkoutIdRef = useRef<string | null>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [showScanner, setShowScanner] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [editLine, setEditLine] = useState<CartItem | null>(null);
  const [lastInvoiceId, setLastInvoiceId] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const { data: firm } = useQuery({
    queryKey: ['business-me'],
    queryFn: () => api<{ name: string }>('/businesses/me', { token }),
  });

  const { catalog, filterProducts, categoryNames, findByBarcode, isLoading: catalogLoading } =
    usePosCatalog(token, branchId);

  const cart = usePosStore((s) => s.cart);
  const addItem = usePosStore((s) => s.addItem);
  const clearCart = usePosStore((s) => s.clearCart);
  const getTotal = usePosStore((s) => s.getTotal);
  const discountPercent = usePosStore((s) => s.discountPercent);
  const secondaryDiscountAmount = usePosStore((s) => s.secondaryDiscountAmount);
  const removeTax = usePosStore((s) => s.removeTax);
  const roundOff = usePosStore((s) => s.roundOff);
  const additionalCharges = usePosStore((s) => s.additionalCharges);
  const customerId = usePosStore((s) => s.customerId);
  const splitPayments = usePosStore((s) => s.splitPayments);

  const products = useMemo(
    () => filterProducts(search, categoryFilter),
    [filterProducts, search, categoryFilter],
  );

  useEffect(() => startSyncInterval(token, clientId.current), [token]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const printThermal = async (txnId: string) => {
    try {
      const res = await api<{ content: string }>(`/receipts/${txnId}/thermal`, { token });
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(`<pre style="font-family:monospace;font-size:12px;white-space:pre-wrap">${res.content}</pre>`);
        w.print();
      }
    } catch {
      toast.error('Print failed');
    }
  };

  const checkout = useMutation({
    mutationFn: async ({ status, print }: { status: 'COMPLETED' | 'HELD'; print?: boolean }) => {
      const idempotencyKey = checkoutIdRef.current ?? crypto.randomUUID();
      checkoutIdRef.current = idempotencyKey;

      const total = getTotal();
      const payments =
        status === 'COMPLETED'
          ? splitPayments.length > 0
            ? splitPayments.map((p) => ({ paymentType: p.method, amount: p.amount }))
            : [{ paymentType: paymentMethod, amount: total }]
          : [];

      if (status === 'COMPLETED' && payments.some((p) => p.paymentType === 'DEBT') && !customerId) {
        throw new Error('Select a party for credit sale');
      }

      const payload = {
        branchId,
        partyId: customerId,
        lines: cart.map((c) => ({
          itemId: c.itemId,
          name: c.name,
          quantity: c.quantity,
          unit: c.unit ?? 'PCS',
          unitPrice: c.unitPrice,
          discountAmount: c.discount,
          taxRate: removeTax ? 0 : c.taxRate,
          hsnCode: c.hsnCode,
        })),
        payments,
        discountPercent,
        discountAmount: secondaryDiscountAmount,
        additionalCharges: additionalCharges > 0 ? [{ name: 'Additional', amount: additionalCharges }] : undefined,
        roundOffEnabled: roundOff,
        pointsRedeemed: usePosStore.getState().pointsRedeemed,
        status: status === 'HELD' ? 'HELD' : undefined,
        clientId: idempotencyKey,
      };

      const heldInvoiceId = usePosStore.getState().heldOrderId;
      let result: { id: string };

      if (status === 'COMPLETED' && heldInvoiceId) {
        result = await api<{ id: string }>(`/sale/invoices/${heldInvoiceId}/resume`, {
          method: 'POST',
          token,
          branchId,
          body: JSON.stringify({ payments }),
          timeoutMs: 20_000,
        });
      } else {
        try {
          result = await api<{ id: string }>('/sale/invoices', {
            method: 'POST',
            token,
            branchId,
            body: JSON.stringify(payload),
            timeoutMs: 20_000,
          });
        } catch {
          await queueSyncOperation({ entity: 'sale_invoice', action: 'create', payload });
          throw new Error('OFFLINE_QUEUED');
        }
      }

      if (print && status === 'COMPLETED') await printThermal(result.id);
      return result;
    },
    onSuccess: (data, { status }) => {
      checkoutIdRef.current = null;
      qc.invalidateQueries({ queryKey: ['held-invoices'] });
      qc.invalidateQueries({ queryKey: ['recent-invoices'] });
      qc.invalidateQueries({ queryKey: ['pos-catalog'] });

      if (status === 'COMPLETED') {
        toast.success('Bill saved successfully');
        if (data?.id) {
          setLastInvoiceId(data.id);
          setShowReceipt(true);
        }
        clearCart();
        usePosStore.getState().setSplitPayments([]);
        searchRef.current?.focus();
      } else {
        toast.success('Bill on hold');
        clearCart();
      }
    },
    onError: (e) => {
      checkoutIdRef.current = null;
      if (e.message === 'OFFLINE_QUEUED') {
        toast.info('Saved offline — will sync when online');
        clearCart();
      } else {
        toast.error(e instanceof Error ? e.message : 'Checkout failed');
      }
    },
  });

  const addProduct = useCallback(
    (p: PosProduct) => {
      if (p.stockQty != null && p.stockQty <= 0) {
        toast.error(`${p.name} is out of stock`);
        return;
      }
      addItem({
        itemId: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        hsnCode: p.hsnCode,
        unit: p.unit,
        stockQty: p.stockQty,
        unitPrice: p.retailPrice,
        taxRate: p.taxRate,
      });
      setSearch('');
      searchRef.current?.focus();
    },
    [addItem],
  );

  const handleBarcode = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      const local = findByBarcode(trimmed);
      if (local) { addProduct(local); return; }
      const cached = await findCachedProductByBarcode(trimmed);
      if (cached && typeof cached === 'object' && 'id' in cached) {
        addProduct(cached as unknown as PosProduct);
        return;
      }
      try {
        const item = await api<{
          id: string; name: string; sku: string; barcode?: string;
          salePrice: number | string; taxRate: number | string; hsnCode?: string; baseUnit?: string;
        }>(`/items/barcode/${encodeURIComponent(trimmed)}`, { token, branchId, timeoutMs: 8_000 });
        addProduct({
          id: item.id,
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          retailPrice: Number(item.salePrice),
          taxRate: Number(item.taxRate),
          hsnCode: item.hsnCode,
          unit: item.baseUnit ?? 'PCS',
          salePriceTaxInclusive: false,
        });
      } catch {
        toast.error('Item not found for barcode');
      }
    },
    [token, branchId, addProduct, findByBarcode],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F12' && cart.length && !checkout.isPending) {
        e.preventDefault();
        checkout.mutate({ status: 'COMPLETED', print: true });
      }
      if (e.key === 'Escape') { setSearch(''); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cart.length, checkout]);

  const gridCols = 4;
  const rowCount = Math.ceil(products.length / gridCols) || 0;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 128,
    overscan: 4,
  });

  const handleSave = (print?: boolean) => checkout.mutate({ status: 'COMPLETED', print });

  return (
    <div className="h-full flex flex-col bg-[hsl(0,0%,96%)]">
      {/* Vyapar POS top bar */}
      <div className="shrink-0 bg-[hsl(348,85%,52%)] text-white px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-white text-[hsl(348,85%,52%)] font-extrabold flex items-center justify-center text-lg">V</div>
          <div>
            <p className="font-bold text-sm leading-tight">Vyapar POS</p>
            <p className="text-[10px] text-white/80">{firm?.name ?? 'Billing'} · Tax Invoice</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HeldOrdersPanel branchId={branchId} />
          <RecentOrdersPanel branchId={branchId} />
          {cart.length > 0 && (
            <Button size="sm" variant="secondary" className="h-8 bg-white/90 text-xs" onClick={() => checkout.mutate({ status: 'HELD' })}>
              <Pause className="h-3.5 w-3.5 mr-1" /> Hold
            </Button>
          )}
        </div>
      </div>

      {showScanner && <BarcodeScanner onScan={handleBarcode} onClose={() => setShowScanner(false)} />}
      {showSplit && (
        <SplitPaymentDialog
          total={getTotal()}
          onClose={() => setShowSplit(false)}
          onConfirm={(payments) => {
            usePosStore.getState().setSplitPayments(payments);
            setShowSplit(false);
            checkout.mutate({ status: 'COMPLETED' });
          }}
        />
      )}
      <PosLineEditDialog item={editLine} open={!!editLine} onClose={() => setEditLine(null)} />

      <Dialog open={showReceipt && !!lastInvoiceId} onOpenChange={setShowReceipt}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bill Saved</DialogTitle>
          </DialogHeader>
          {lastInvoiceId && <ReceiptActions txnId={lastInvoiceId} />}
        </DialogContent>
      </Dialog>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* LEFT — Items panel (Vyapar POS item picker) */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 border-r bg-white">
          <div className="p-3 border-b flex gap-2 items-center">
            <div className="relative flex-1">
              <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(348,85%,52%)]" />
              <Input
                ref={searchRef}
                placeholder="Search item / scan barcode (F2)"
                className="pl-10 h-11 text-sm border-[hsl(348,50%,85%)] focus-visible:ring-[hsl(348,85%,52%)]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleBarcode(search); }}
                autoFocus
              />
            </div>
            <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => setShowScanner(true)}>
              <Camera className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex gap-1.5 px-3 py-2 overflow-x-auto border-b bg-[hsl(348,30%,98%)] scrollbar-hide">
            <button
              type="button"
              onClick={() => setCategoryFilter(null)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors',
                !categoryFilter ? 'bg-[hsl(348,85%,52%)] text-white' : 'bg-white border hover:bg-muted',
              )}
            >
              All Items
            </button>
            {categoryNames.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors',
                  categoryFilter === cat ? 'bg-[hsl(348,85%,52%)] text-white' : 'bg-white border hover:bg-muted',
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          <div ref={parentRef} className="flex-1 overflow-y-auto p-3">
            {catalogLoading && !catalog.length ? (
              <p className="text-center text-muted-foreground py-16">Loading items…</p>
            ) : products.length === 0 ? (
              <p className="text-center text-muted-foreground py-16">No items found</p>
            ) : (
              <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const start = virtualRow.index * gridCols;
                  const rowProducts = products.slice(start, start + gridCols);
                  return (
                    <div
                      key={virtualRow.key}
                      className="absolute left-0 right-0 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 px-0.5"
                      style={{ top: virtualRow.start, height: virtualRow.size }}
                    >
                      {rowProducts.map((p) => {
                        const lowStock = p.minStock != null && p.stockQty != null && p.stockQty <= p.minStock;
                        const outOfStock = p.stockQty != null && p.stockQty <= 0;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            disabled={outOfStock}
                            onClick={() => addProduct(p)}
                            className={cn(
                              'text-left rounded-lg border p-3 transition-all active:scale-[0.98] min-h-[110px] flex flex-col',
                              outOfStock ? 'opacity-50 cursor-not-allowed bg-muted' : 'hover:border-[hsl(348,85%,52%)] hover:shadow-md bg-white',
                            )}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <p className="font-semibold text-xs line-clamp-2 leading-tight flex-1">{p.name}</p>
                              <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{p.sku}</p>
                            <p className="text-base font-bold text-[hsl(348,85%,52%)] mt-auto pt-1">
                              {formatCurrency(p.retailPrice)}
                              <span className="text-[10px] font-normal text-muted-foreground">/{p.unit}</span>
                            </p>
                            {p.stockQty != null && (
                              <p className={cn('text-[10px] mt-0.5 flex items-center gap-0.5', lowStock ? 'text-orange-600' : 'text-muted-foreground')}>
                                {lowStock && <AlertTriangle className="h-3 w-3" />}
                                Stock: {p.stockQty}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Bill panel (Vyapar invoice table) */}
        <div className="w-full lg:w-[440px] xl:w-[480px] flex flex-col min-h-0 bg-white shadow-xl">
          <div className="px-3 py-2 border-b bg-[hsl(348,30%,98%)] flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-[hsl(348,85%,52%)] uppercase tracking-wide">Sale Bill</p>
              <p className="text-[10px] text-muted-foreground">Add party for credit / GST invoice</p>
            </div>
            {cart.length > 0 && (
              <button type="button" onClick={clearCart} className="text-muted-foreground hover:text-destructive p-1">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="px-3 py-2 border-b">
            <CustomerPicker />
          </div>

          <PosCartTable onEditLine={setEditLine} />

          <PosBillFooter
            paymentMethod={paymentMethod}
            onPaymentMethod={setPaymentMethod}
            onSplit={() => setShowSplit(true)}
            onSave={handleSave}
            onHold={() => checkout.mutate({ status: 'HELD' })}
            onClear={clearCart}
            isPending={checkout.isPending}
            hasCart={cart.length > 0}
          />
        </div>
      </div>
    </div>
  );
}
