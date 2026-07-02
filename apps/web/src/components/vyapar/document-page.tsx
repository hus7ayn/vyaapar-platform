'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatCurrency } from '@/lib/utils';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { VyaparActionButton } from '@/components/vyapar/action-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type DocItem = { productId?: string; name: string; quantity: number; unitPrice: number; taxRate?: number };
type BusinessDoc = {
  id: string;
  docNumber: string;
  docType: string;
  total: string | number;
  docDate: string;
  status: string;
  items: { name: string; quantity: string | number; unitPrice: string | number }[];
};

type Customer = { id: string; name: string };
type Supplier = { id: string; name: string };
type Product = { id: string; name: string; retailPrice: string | number; taxRate?: string | number };

type Props = {
  shopId: string;
  docType: string;
  title: string;
  subtitle: string;
  partyType?: 'customer' | 'supplier' | 'none';
  accentColor?: string;
};

export function VyaparDocumentPage({
  shopId,
  docType,
  title,
  subtitle,
  partyType = 'customer',
  accentColor = 'bg-[hsl(348,85%,52%)]',
}: Props) {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [partyId, setPartyId] = useState('');
  const [lineItems, setLineItems] = useState<DocItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');

  const { data: docs, isLoading } = useQuery<BusinessDoc[]>({
    queryKey: ['documents', docType, shopId],
    queryFn: () => api<BusinessDoc[]>(`/accounting/documents/${docType}?branchId=${shopId}`, { token }),
  });

  const { data: customers } = useQuery<{ data: Customer[] }>({
    queryKey: ['customers-list'],
    queryFn: () => api<{ data: Customer[] }>(`/customers?branchId=${shopId}&limit=100`, { token }),
    enabled: partyType === 'customer',
  });

  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers', { token }),
    enabled: partyType === 'supplier',
  });

  const { data: products } = useQuery<{ data: Product[] }>({
    queryKey: ['products-list'],
    queryFn: () => api<{ data: Product[] }>('/products?limit=200', { token }),
  });

  const createDoc = useMutation({
    mutationFn: () =>
      api(`/accounting/documents/${docType}`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          branchId: shopId,
          customerId: partyType === 'customer' ? partyId || undefined : undefined,
          supplierId: partyType === 'supplier' ? partyId || undefined : undefined,
          items: lineItems,
          notes: notes || undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents', docType] });
      toast.success(`${title} created`);
      setShowCreate(false);
      setLineItems([]);
      setPartyId('');
      setNotes('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addLine = () => {
    if (!selectedProduct) return;
    const product = products?.data.find((p) => p.id === selectedProduct);
    setLineItems([
      ...lineItems,
      {
        productId: selectedProduct,
        name: product?.name ?? 'Item',
        quantity: qty,
        unitPrice: Number(product?.retailPrice ?? 0),
        taxRate: Number(product?.taxRate ?? 0),
      },
    ]);
    setSelectedProduct('');
    setQty(1);
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl">
      <VyaparPageHeader
        title={title}
        subtitle={subtitle}
        action={<VyaparActionButton onClick={() => setShowCreate(true)} label={`New ${title}`} color={accentColor} />}
      />

      <div className="bg-white rounded-lg border shadow-sm divide-y">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading...</p>
        ) : !docs?.length ? (
          <p className="p-6 text-sm text-muted-foreground">No {title.toLowerCase()} yet</p>
        ) : (
          docs.map((doc) => (
            <div key={doc.id} className="p-4 flex justify-between items-start gap-4">
              <div>
                <p className="font-semibold">{doc.docNumber}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(doc.docDate).toLocaleDateString()} · {doc.status}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {doc.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}
                </p>
              </div>
              <p className="font-bold text-[hsl(348,85%,52%)]">{formatCurrency(Number(doc.total))}</p>
            </div>
          ))
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create {title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {partyType === 'customer' && (
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
              >
                <option value="">Select customer (optional)</option>
                {customers?.data.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            {partyType === 'supplier' && (
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
              >
                <option value="">Select supplier (optional)</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}

            <div className="flex gap-2">
              <select
                className="flex-1 border rounded-md px-3 py-2 text-sm"
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
              >
                <option value="">Select item</option>
                {products?.data.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-20" />
              <Button type="button" size="sm" onClick={addLine}><Plus className="h-4 w-4" /></Button>
            </div>

            {lineItems.length > 0 && (
              <div className="border rounded-md divide-y text-sm">
                {lineItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center p-2">
                    <span>{item.name} × {item.quantity}</span>
                    <div className="flex items-center gap-2">
                      <span>{formatCurrency(item.unitPrice * item.quantity)}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLineItems(lineItems.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

            <Button
              className="w-full bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)]"
              disabled={!lineItems.length || createDoc.isPending}
              onClick={() => createDoc.mutate()}
            >
              {createDoc.isPending ? 'Creating...' : `Create ${title}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
