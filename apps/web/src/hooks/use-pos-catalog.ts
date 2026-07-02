import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cacheProducts } from '@/lib/offline-db';

export interface PosProduct {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  retailPrice: number;
  taxRate: number;
  hsnCode?: string;
  unit: string;
  stockQty?: number;
  minStock?: number;
  salePriceTaxInclusive: boolean;
  category?: { id: string; name: string };
}

interface PosCatalogResponse {
  items: {
    id: string;
    name: string;
    sku: string;
    barcode?: string | null;
    salePrice: number | string;
    taxRate: number | string;
    hsnCode?: string | null;
    baseUnit?: string;
    currentStock?: number | string;
    minStock?: number | string | null;
    salePriceTaxInclusive?: boolean;
    category?: { id: string; name: string } | null;
  }[];
  categories: { id: string; name: string }[];
}

function resolveUnitPrice(salePrice: number, taxRate: number, taxInclusive: boolean) {
  if (!taxInclusive || taxRate <= 0) return salePrice;
  return salePrice / (1 + taxRate / 100);
}

export function usePosCatalog(token: string, branchId?: string) {
  const query = useQuery({
    queryKey: ['pos-catalog', branchId],
    queryFn: async () => {
      const data = await api<PosCatalogResponse>('/items/pos-catalog', { token, branchId, retries: 2 });
      const products: PosProduct[] = data.items.map((i) => {
        const salePrice = Number(i.salePrice);
        const taxRate = Number(i.taxRate);
        const taxInclusive = i.salePriceTaxInclusive ?? false;
        return {
          id: i.id,
          name: i.name,
          sku: i.sku,
          barcode: i.barcode ?? undefined,
          retailPrice: resolveUnitPrice(salePrice, taxRate, taxInclusive),
          taxRate,
          hsnCode: i.hsnCode ?? undefined,
          unit: i.baseUnit ?? 'PCS',
          stockQty: i.currentStock != null ? Number(i.currentStock) : undefined,
          minStock: i.minStock != null ? Number(i.minStock) : undefined,
          salePriceTaxInclusive: taxInclusive,
          category: i.category ?? undefined,
        };
      });
      await cacheProducts(products as unknown as Record<string, unknown>[]);
      return { products, categories: data.categories };
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 2,
  });

  const catalog = query.data?.products ?? [];

  const filterProducts = useMemo(
    () => (search: string, categoryName: string | null) => {
      const q = search.trim().toLowerCase();
      return catalog.filter((p) => {
        if (categoryName && p.category?.name !== categoryName) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode?.toLowerCase().includes(q) ?? false) ||
          (p.hsnCode?.toLowerCase().includes(q) ?? false)
        );
      });
    },
    [catalog],
  );

  const categoryNames = useMemo(
    () => query.data?.categories.map((c) => c.name) ?? [...new Set(catalog.map((p) => p.category?.name).filter(Boolean))] as string[],
    [catalog, query.data?.categories],
  );

  const findByBarcode = useMemo(
    () => (code: string) => catalog.find((p) => p.barcode === code.trim()),
    [catalog],
  );

  return { ...query, catalog, filterProducts, categoryNames, findByBarcode };
}
