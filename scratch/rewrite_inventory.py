import re

def rewrite():
    with open('apps/web/src/app/(app)/shops/[shopId]/inventory/page.tsx', 'r') as f:
        content = f.read()

    # We will replace the entire return statement.
    # First, let's extract the imports and component body before return.
    
    # Let's just create the new content from scratch to be safe and clean.
    new_content = """'use client';

import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Upload, AlertTriangle, Package, ArrowRightLeft, Layers, Camera, Store as StoreIcon, Edit, Search } from 'lucide-react';
import { toast } from 'sonner';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatCurrency, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const BarcodeScanner = dynamic(
  () => import('@/components/pos/barcode-scanner').then((m) => m.BarcodeScanner),
  { ssr: false },
);

interface Variant {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  price: number | string;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  retailPrice: number | string;
  costPrice?: number | string;
  category?: { name: string };
  variants?: Variant[];
}

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

interface StockLevel {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: string | number;
  warehouse: Warehouse;
}

export default function InventoryPage({ params }: { params: { shopId: string } }) {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  
  const [newProduct, setNewProduct] = useState({
    name: '', sku: '', retailPrice: 0, costPrice: 0, taxRate: 18,
    minStock: 5, openingStock: 0, mrp: 0, itemCode: '', color: '', size: '',
    labelType: 'BAG LABEL', packDate: '', sideCodeLeft: '', sideCodeRight: '', barcode: ''
  });
  
  const [transfer, setTransfer] = useState({
    productId: '',
    fromWarehouseId: '',
    toWarehouseId: '',
    quantity: 1,
  });
  const [transferOpen, setTransferOpen] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [addProductOpen, setAddProductOpen] = useState(false);

  const { data: products } = useQuery({
    queryKey: ['products-all', search],
    queryFn: () => api<{ data: Product[] }>(`/products?limit=100&search=${search}`, { token }),
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api<Warehouse[]>('/inventory/warehouses', { token }),
  });

  const { data: stockLevels } = useQuery({
    queryKey: ['stock-levels', params.shopId],
    queryFn: () => api<StockLevel[]>(`/inventory/stock?branchId=${params.shopId}`, { token }),
  });

  const { data: lowStock } = useQuery({
    queryKey: ['low-stock', params.shopId],
    queryFn: () =>
      api<Array<{ product: { name: string; sku: string }; quantity: number; minStock: number }>>(
        `/inventory/low-stock?branchId=${params.shopId}`,
        { token },
      ),
  });

  const transferStock = useMutation({
    mutationFn: () =>
      api('/inventory/transfer', { method: 'POST', token, body: JSON.stringify(transfer) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      toast.success('Stock transferred');
      setTransferOpen(false);
      setTransfer({ productId: '', fromWarehouseId: '', toWarehouseId: '', quantity: 1 });
    },
    onError: (e: Error) => toast.error(e.message || 'Transfer failed'),
  });

  const createProduct = useMutation({
    mutationFn: () =>
      api('/products', { 
        method: 'POST', 
        token, 
        body: JSON.stringify({
          ...newProduct,
          branchId: params.shopId // Assign stock to current branch
        }) 
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products-all'] });
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      toast.success('Product created');
      setAddProductOpen(false);
      setNewProduct({
        name: '', sku: '', retailPrice: 0, costPrice: 0, taxRate: 18,
        minStock: 5, openingStock: 0, mrp: 0, itemCode: '', color: '', size: '',
        labelType: 'BAG LABEL', packDate: '', sideCodeLeft: '', sideCodeRight: '', barcode: ''
      });
    },
  });

  const handleCsvImport = async (file: File) => {
    const text = await file.text();
    const lines = text.trim().split('\\n').slice(1);
    const rows = lines.map((line) => {
      const [name, sku, retailPrice, barcode] = line.split(',').map((s) => s.trim());
      return { name, sku, retailPrice: parseFloat(retailPrice), barcode: barcode || undefined };
    });
    await api('/products/import', { method: 'POST', token, body: JSON.stringify({ rows }) });
    qc.invalidateQueries({ queryKey: ['products-all'] });
    toast.success(`Imported ${rows.length} products`);
  };

  const selectedProductStock = useMemo(() => {
    if (!selectedProduct || !stockLevels) return [];
    return stockLevels.filter(s => s.productId === selectedProduct.id);
  }, [selectedProduct, stockLevels]);

  const stockValue = useMemo(() => {
    if (!stockLevels || !products?.data) return 0;
    return stockLevels.reduce((acc, stock) => {
      const product = products.data.find(p => p.id === stock.productId);
      const price = Number(product?.costPrice || product?.retailPrice || 0);
      return acc + (Number(stock.quantity) * price);
    }, 0);
  }, [stockLevels, products?.data]);

  return (
    <div className="p-6 space-y-6">
      {showScanner && (
        <BarcodeScanner 
          onScan={(code) => {
            setNewProduct(p => ({ ...p, barcode: code, sku: p.sku || code }));
            setShowScanner(false);
          }} 
          onClose={() => setShowScanner(false)} 
        />
      )}

      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-muted-foreground">Manage products, stock & barcodes</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleCsvImport(e.target.files[0])}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" /> Import CSV
          </Button>
          <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <ArrowRightLeft className="h-4 w-4 mr-2" /> Transfer stock
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transfer between shops</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  value={transfer.productId}
                  onChange={(e) => setTransfer({ ...transfer, productId: e.target.value })}
                >
                  <option value="">Select product</option>
                  {products?.data.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  value={transfer.fromWarehouseId}
                  onChange={(e) => setTransfer({ ...transfer, fromWarehouseId: e.target.value })}
                >
                  <option value="">From shop</option>
                  {warehouses?.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  value={transfer.toWarehouseId}
                  onChange={(e) => setTransfer({ ...transfer, toWarehouseId: e.target.value })}
                >
                  <option value="">To shop</option>
                  {warehouses?.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={1}
                  value={transfer.quantity}
                  onChange={(e) => setTransfer({ ...transfer, quantity: parseInt(e.target.value, 10) || 1 })}
                />
                <Button
                  className="w-full"
                  disabled={!transfer.productId || !transfer.fromWarehouseId || !transfer.toWarehouseId}
                  onClick={() => transferStock.mutate()}
                >
                  Transfer
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          
          <Button variant="outline" onClick={() => setShowScanner(true)}>
            <Camera className="h-4 w-4 mr-2" /> Barcode
          </Button>

          <Dialog open={addProductOpen} onOpenChange={setAddProductOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Add Product
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Product</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className="md:col-span-2">
                  <label className="text-sm font-medium">Name *</label>
                  <Input value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} />
                </div>
                
                <div>
                  <label className="text-sm font-medium">Purchase Price</label>
                  <Input type="number" value={newProduct.costPrice || ''} onChange={(e) => setNewProduct({ ...newProduct, costPrice: parseFloat(e.target.value) })} />
                </div>
                <div>
                  <label className="text-sm font-medium">Selling Price</label>
                  <Input type="number" value={newProduct.retailPrice || ''} onChange={(e) => setNewProduct({ ...newProduct, retailPrice: parseFloat(e.target.value) })} />
                </div>
                
                <div>
                  <label className="text-sm font-medium">GST %</label>
                  <Input type="number" value={newProduct.taxRate || ''} onChange={(e) => setNewProduct({ ...newProduct, taxRate: parseFloat(e.target.value) })} />
                </div>
                <div>
                  <label className="text-sm font-medium">Min Stock</label>
                  <Input type="number" value={newProduct.minStock || ''} onChange={(e) => setNewProduct({ ...newProduct, minStock: parseFloat(e.target.value) })} />
                </div>

                <div>
                  <label className="text-sm font-medium">Opening Stock</label>
                  <Input type="number" value={newProduct.openingStock || ''} onChange={(e) => setNewProduct({ ...newProduct, openingStock: parseFloat(e.target.value) })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Barcode (Click to scan)</label>
                  <div className="flex gap-2">
                    <Input value={newProduct.barcode} onChange={(e) => setNewProduct({ ...newProduct, barcode: e.target.value })} />
                    <Button variant="outline" size="icon" onClick={() => setShowScanner(true)}>
                      <Camera className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">MRP</label>
                  <Input type="number" value={newProduct.mrp || ''} onChange={(e) => setNewProduct({ ...newProduct, mrp: parseFloat(e.target.value) })} />
                </div>
                <div>
                  <label className="text-sm font-medium">Item Code (SKU)</label>
                  <Input value={newProduct.sku} onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value, itemCode: e.target.value })} />
                </div>

                <div>
                  <label className="text-sm font-medium">Colour</label>
                  <Input value={newProduct.color} onChange={(e) => setNewProduct({ ...newProduct, color: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium">Size</label>
                  <Input value={newProduct.size} onChange={(e) => setNewProduct({ ...newProduct, size: e.target.value })} />
                </div>

                <div>
                  <label className="text-sm font-medium">Label type</label>
                  <Input value={newProduct.labelType} onChange={(e) => setNewProduct({ ...newProduct, labelType: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium">Pack date</label>
                  <Input type="date" value={newProduct.packDate} onChange={(e) => setNewProduct({ ...newProduct, packDate: e.target.value })} />
                </div>

                <div>
                  <label className="text-sm font-medium">Side code (left)</label>
                  <Input value={newProduct.sideCodeLeft} onChange={(e) => setNewProduct({ ...newProduct, sideCodeLeft: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium">Side code (right)</label>
                  <Input value={newProduct.sideCodeRight} onChange={(e) => setNewProduct({ ...newProduct, sideCodeRight: e.target.value })} />
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm font-medium block mb-2">Product image</label>
                  <div className="h-32 w-32 border-2 border-dashed rounded-lg flex items-center justify-center bg-muted/50 cursor-pointer hover:bg-muted transition-colors">
                    <Camera className="h-8 w-8 text-muted-foreground" />
                  </div>
                </div>

                <div className="md:col-span-2 flex justify-center mt-4">
                  <Button onClick={() => createProduct.mutate()} className="w-full md:w-auto px-8" size="lg">Save Product</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="bg-[#1C143B] text-white border-0">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm text-indigo-200 mb-1">Stock Value</p>
                <h3 className="text-3xl font-bold">{formatCurrency(stockValue)}</h3>
              </div>
              <Package className="h-5 w-5 text-indigo-300" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-[#0D1F25] text-white border-0">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm text-emerald-200 mb-1">Low Stock Items</p>
                <h3 className="text-3xl font-bold">{lowStock?.length || 0}</h3>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1B2234] text-white border-0">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm text-slate-300 mb-1">Total Items</p>
                <h3 className="text-3xl font-bold">{products?.data.length || 0}</h3>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 max-w-md mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search name, SKU, barcode..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            className="pl-9 bg-background/50 border-white/10" 
          />
        </div>
      </div>

      <Card className="overflow-hidden border-white/5 bg-transparent shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Barcode</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {products?.data.map((p) => {
                const stock = stockLevels?.find(s => s.productId === p.id);
                const stockQty = Number(stock?.quantity || 0);
                
                return (
                  <tr key={p.id} className="hover:bg-white/5 transition-colors cursor-pointer" onClick={() => setSelectedProduct(p)}>
                    <td className="px-4 py-3 font-medium text-primary">{p.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.sku}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.barcode || '-'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.category?.name || '-'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded bg-white/10 text-xs font-bold">
                        {stockQty}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{formatCurrency(Number(p.retailPrice))}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {(!products?.data || products.data.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!selectedProduct} onOpenChange={(open) => !open && setSelectedProduct(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              {selectedProduct?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-between text-sm text-muted-foreground bg-muted p-3 rounded-lg">
              <div>
                <p className="font-medium text-foreground">SKU</p>
                <p>{selectedProduct?.sku}</p>
              </div>
              <div className="text-right">
                <p className="font-medium text-foreground">Price</p>
                <p className="text-primary font-bold">{formatCurrency(Number(selectedProduct?.retailPrice))}</p>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-3">Stock Levels by Shop</h3>
              {selectedProductStock.length > 0 ? (
                <div className="space-y-2">
                  {selectedProductStock.map((stock) => (
                    <div key={stock.id} className="flex justify-between items-center p-3 border rounded-lg bg-card">
                      <div className="flex items-center gap-2">
                        <StoreIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">{stock.warehouse?.name}</span>
                      </div>
                      <span className="font-bold">{Number(stock.quantity)} units</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No stock recorded in any shop.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
"""
    with open('apps/web/src/app/(app)/shops/[shopId]/inventory/page.tsx', 'w') as f:
        f.write(new_content)

if __name__ == '__main__':
    rewrite()
