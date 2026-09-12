import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBranchWarehouse } from '../inventory/warehouse.util';
import {
  BARCODE_PREFIX_LEN,
  buildItemBarcode,
  decodeCostFromBarcode,
  isCostEncodedBarcode,
} from './barcode.util';
import { EventsGateway } from '../events/events.gateway';

export interface ItemInput {
  name: string;
  itemType?: string;
  sku?: string;
  size?: string;
  hsnCode?: string;
  categoryId?: string;
  description?: string;
  imageUrl?: string;
  salePrice?: number;
  salePriceTaxInclusive?: boolean;
  purchasePrice?: number;
  purchasePriceTaxInclusive?: boolean;
  costPrice?: number;
  wholesalePrice?: number;
  wholesaleMinQty?: number;
  mrp?: number;
  taxRate?: number;
  discountOnSalePercent?: number;
  baseUnit?: string;
  secondaryUnit?: string;
  conversionRate?: number;
  openingStock?: number;
  openingStockPrice?: number;
  minStock?: number;
  location?: string;
  trackStock?: boolean;
}

const DEFAULT_UNITS = [
  { name: 'Pieces', shortName: 'PCS' },
  { name: 'Kilograms', shortName: 'KG' },
  { name: 'Grams', shortName: 'GM' },
  { name: 'Litres', shortName: 'LTR' },
  { name: 'Millilitres', shortName: 'ML' },
  { name: 'Metres', shortName: 'MTR' },
  { name: 'Box', shortName: 'BOX' },
  { name: 'Dozens', shortName: 'DZN' },
  { name: 'Packs', shortName: 'PAC' },
  { name: 'Numbers', shortName: 'NOS' },
  { name: 'Bags', shortName: 'BAG' },
  { name: 'Bottles', shortName: 'BTL' },
];

@Injectable()
export class ItemsService {
  constructor(private prisma: PrismaService, private events: EventsGateway) {}

  private branchWhere(branchId?: string) {
    return branchId ? { branchId } : {};
  }

  private async attachBranchStock<T extends { id: string; currentStock: Prisma.Decimal; minStock: Prisma.Decimal | null; costPrice: Prisma.Decimal; purchasePrice: Prisma.Decimal }>(
    businessId: string,
    branchId: string | undefined,
    items: T[],
  ) {
    if (!branchId || !items.length) return items;
    const levels = await this.prisma.stockLevel.findMany({
      where: { branchId, itemId: { in: items.map((i) => i.id) }, warehouse: { businessId } },
      select: { itemId: true, quantity: true },
    });
    const qtyMap = new Map(levels.map((l) => [l.itemId, Number(l.quantity)]));
    return items.map((i) => ({
      ...i,
      currentStock: new Prisma.Decimal(qtyMap.get(i.id) ?? 0),
    }));
  }

  async list(businessId: string, q: { search?: string; categoryId?: string; type?: string; lowStock?: string; branchId?: string; size?: string }) {
    let items = await this.prisma.item.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...this.branchWhere(q.branchId),
        ...(q.categoryId && { categoryId: q.categoryId }),
        ...(q.type && { itemType: q.type }),
        ...(q.size && { size: q.size }),
        ...(q.search && {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            { sku: { contains: q.search, mode: 'insensitive' } },
            { barcode: { contains: q.search } },
            { hsnCode: { contains: q.search } },
            { size: { contains: q.search, mode: 'insensitive' } },
          ],
        }),
      },
      include: { category: true, variants: true },
      orderBy: { name: 'asc' },
    });
    items = await this.attachBranchStock(businessId, q.branchId, items);
    if (q.lowStock === 'true') {
      return items.filter((i) => i.minStock != null && Number(i.currentStock) <= Number(i.minStock));
    }
    return items;
  }

  async summary(businessId: string, branchId?: string) {
    const items = await this.list(businessId, { branchId });
    let stockValue = 0;
    let lowStockCount = 0;
    for (const i of items) {
      const unitCost = i.costPrice != null ? Number(i.costPrice) : i.purchasePrice != null ? Number(i.purchasePrice) : Number(i.salePrice);
      stockValue += Number(i.currentStock) * unitCost;
      if (i.minStock != null && Number(i.currentStock) <= Number(i.minStock)) lowStockCount++;
    }
    return { itemCount: items.length, stockValue, lowStockCount };
  }

  async get(businessId: string, id: string, branchId?: string) {
    const item = await this.prisma.item.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { category: true, variants: true, adjustments: { orderBy: { date: 'desc' } } },
    });
    if (!item) throw new NotFoundException('Item not found');
    const [withStock] = await this.attachBranchStock(businessId, branchId, [item]);
    return withStock;
  }

  async transactions(businessId: string, id: string) {
    return this.prisma.txnLine.findMany({
      where: { itemId: id, txn: { businessId, deletedAt: null } },
      include: { txn: { select: { id: true, txnType: true, txnNumber: true, date: true, partyName: true, status: true } } },
      orderBy: { txn: { date: 'desc' } },
    });
  }

  async findByBarcode(businessId: string, barcode: string, branchId?: string) {
    const item = await this.prisma.item.findFirst({
      where: {
        businessId,
        deletedAt: null,
        ...this.branchWhere(branchId),
        OR: [{ barcode }, { sku: barcode }, { variants: { some: { barcode } } }],
      },
      include: { variants: true },
    });
    if (!item) throw new NotFoundException('Item not found for barcode');
    // Only decode a cost out of a barcode this app generated. A seeded/imported/hand-typed value
    // (or a match on sku, which carries no cost digits at all) has arbitrary trailing digits, and
    // reporting those as a cost price is how a ₹168 item ends up looking like it cost ₹30.01.
    const cost = Number(item.costPrice) || Number(item.purchasePrice) || 0;
    const decodedCost = isCostEncodedBarcode(barcode, item, cost) ? decodeCostFromBarcode(barcode) : null;
    return { ...item, decodedBarcodeCost: decodedCost };
  }

  async posCatalog(businessId: string, branchId?: string) {
    const [items, categories] = await Promise.all([
      this.prisma.item.findMany({
        where: { businessId, deletedAt: null, isActive: true, ...this.branchWhere(branchId) },
        include: { variants: { where: { isActive: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.category.findMany({ where: { businessId, deletedAt: null, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    ]);
    return { items, categories };
  }

  async create(businessId: string, body: ItemInput, branchId?: string, opts?: { requireComplete?: boolean }) {
    if (!body.name?.trim()) throw new BadRequestException('Item name is required');
    if (opts?.requireComplete) {
      // Interactive "Add Item" requires a complete record; the bulk import path
      // calls create() without this flag so partial catalogs can still load.
      const isService = body.itemType === 'SERVICE';
      if (!body.categoryId) throw new BadRequestException('Category is required');
      if (body.salePrice === undefined || body.salePrice === null) throw new BadRequestException('Sale price is required');
      if ((body.costPrice ?? body.purchasePrice) === undefined || (body.costPrice ?? body.purchasePrice) === null)
        throw new BadRequestException('Cost price is required');
      if (!body.baseUnit?.trim()) throw new BadRequestException('Unit is required');
      if (!isService) {
        if (body.openingStock === undefined || body.openingStock === null)
          throw new BadRequestException('Opening stock (no. of products) is required');
        // Barcode is never asked for — the server always generates it (see create() below).
      }
    }
    const sku = body.sku?.trim() || `ITM-${Date.now().toString(36).toUpperCase()}`;
    const openingStock = new Prisma.Decimal(body.openingStock ?? 0);
    const costPrice = body.costPrice ?? body.purchasePrice ?? 0;

    // Barcode is system-owned and never taken from the client: its trailing digits encode the cost
    // price, so a hand-typed value decodes to the wrong cost on every scan.
    const barcode = await this.generateUniqueBarcode(businessId, { sku, id: sku }, Number(costPrice));
    const resolvedBranch =
      branchId
      ?? (await this.prisma.branch.findFirst({ where: { businessId, isDefault: true, deletedAt: null } }))?.id
      ?? (await this.prisma.branch.findFirst({ where: { businessId, type: 'SHOP', deletedAt: null } }))?.id;

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          businessId,
          branchId: resolvedBranch,
          name: body.name.trim(),
          itemType: body.itemType ?? 'PRODUCT',
          sku,
          barcode,
          size: body.size?.trim() || null,
          hsnCode: body.hsnCode,
          categoryId: body.categoryId,
          description: body.description,
          imageUrl: body.imageUrl,
          salePrice: body.salePrice ?? 0,
          salePriceTaxInclusive: body.salePriceTaxInclusive ?? false,
          purchasePrice: body.purchasePrice ?? 0,
          purchasePriceTaxInclusive: body.purchasePriceTaxInclusive ?? false,
          costPrice,
          wholesalePrice: body.wholesalePrice,
          wholesaleMinQty: body.wholesaleMinQty,
          mrp: body.mrp,
          taxRate: body.taxRate ?? 0,
          discountOnSalePercent: body.discountOnSalePercent,
          baseUnit: (body.baseUnit ?? 'PCS').toUpperCase(),
          secondaryUnit: body.secondaryUnit?.toUpperCase(),
          conversionRate: body.conversionRate,
          openingStock,
          openingStockPrice: body.openingStockPrice,
          currentStock: body.itemType === 'SERVICE' ? 0 : openingStock,
          minStock: body.minStock,
          location: body.location,
          trackStock: body.itemType === 'SERVICE' ? false : (body.trackStock ?? true),
        },
      });

      if (openingStock.gt(0) && item.trackStock && resolvedBranch) {
        const branch = await tx.branch.findFirst({ where: { id: resolvedBranch, businessId } });
        if (branch) {
          const warehouse = await resolveBranchWarehouse(tx, businessId, branch.id);
          if (warehouse) {
            await tx.stockLevel.create({
              data: { itemId: item.id, warehouseId: warehouse.id, branchId: branch.id, quantity: openingStock },
            });
            await tx.stockMovement.create({
              data: { businessId, itemId: item.id, warehouseId: warehouse.id, branchId: branch.id, type: 'OPENING', quantity: openingStock, reference: 'Opening stock' },
            });
          }
        }
      }
      return item;
    });
  }

  async update(businessId: string, id: string, body: Partial<ItemInput> & { isActive?: boolean }) {
    const existing = await this.get(businessId, id);
    // The barcode encodes the cost price in its trailing digits, so a cost change has to be mirrored
    // into it — otherwise every later scan decodes the superseded cost. The 8-digit prefix is
    // preserved so the item keeps the identity already printed on its shelf tags.
    const nextCost = body.costPrice ?? body.purchasePrice;
    const currentCost = Number(existing.costPrice) || Number(existing.purchasePrice) || 0;
    const rebuiltBarcode =
      nextCost !== undefined && Number(nextCost) !== currentCost
        ? await this.generateUniqueBarcode(
            businessId,
            { sku: body.sku ?? existing.sku, id: existing.id },
            Number(nextCost),
            {
              excludeItemId: existing.id,
              existingPrefix: existing.barcode?.replace(/\D/g, '').slice(0, BARCODE_PREFIX_LEN),
            },
          )
        : undefined;
    const item = await this.prisma.item.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.itemType !== undefined && { itemType: body.itemType }),
        ...(body.sku !== undefined && { sku: body.sku }),
        ...(rebuiltBarcode && { barcode: rebuiltBarcode }),
        ...(body.size !== undefined && { size: body.size?.trim() || null }),
        ...(body.hsnCode !== undefined && { hsnCode: body.hsnCode }),
        ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl }),
        ...(body.salePrice !== undefined && { salePrice: body.salePrice }),
        ...(body.salePriceTaxInclusive !== undefined && { salePriceTaxInclusive: body.salePriceTaxInclusive }),
        ...(body.purchasePrice !== undefined && { purchasePrice: body.purchasePrice }),
        ...(body.purchasePriceTaxInclusive !== undefined && { purchasePriceTaxInclusive: body.purchasePriceTaxInclusive }),
        ...(body.costPrice !== undefined && { costPrice: body.costPrice }),
        ...(body.wholesalePrice !== undefined && { wholesalePrice: body.wholesalePrice }),
        ...(body.wholesaleMinQty !== undefined && { wholesaleMinQty: body.wholesaleMinQty }),
        ...(body.mrp !== undefined && { mrp: body.mrp }),
        ...(body.taxRate !== undefined && { taxRate: body.taxRate }),
        ...(body.discountOnSalePercent !== undefined && { discountOnSalePercent: body.discountOnSalePercent }),
        ...(body.baseUnit !== undefined && { baseUnit: body.baseUnit?.toUpperCase() }),
        ...(body.secondaryUnit !== undefined && { secondaryUnit: body.secondaryUnit?.toUpperCase() || null }),
        ...(body.conversionRate !== undefined && { conversionRate: body.conversionRate }),
        ...(body.minStock !== undefined && { minStock: body.minStock }),
        ...(body.location !== undefined && { location: body.location }),
        ...(body.trackStock !== undefined && { trackStock: body.trackStock }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    this.events.emitInventoryUpdate(businessId, { itemId: id });
    return item;
  }

  async remove(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.item.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  // ─── Stock adjustment ──────────────────────────────────────────────────────

  async adjustStock(
    businessId: string,
    id: string,
    body: { adjType: string; quantity: number; atPrice?: number; details?: string; date?: string },
    branchId?: string,
  ) {
    const item = await this.get(businessId, id);
    if (!item.trackStock) throw new BadRequestException('Item does not track stock');
    const qty = new Prisma.Decimal(body.quantity);
    if (qty.lte(0)) throw new BadRequestException('Quantity must be positive');
    const signed = body.adjType === 'REDUCE' ? qty.neg() : qty;

    const adj = await this.prisma.$transaction(async (tx) => {
      const adj = await tx.stockAdjustment.create({
        data: {
          businessId,
          itemId: id,
          adjType: body.adjType === 'REDUCE' ? 'REDUCE' : 'ADD',
          quantity: qty,
          atPrice: body.atPrice,
          details: body.details,
          date: body.date ? new Date(body.date) : new Date(),
        },
      });
      await tx.item.update({ where: { id }, data: { currentStock: { increment: signed } } });

      const resolvedBranchId = branchId ?? item.branchId;
      const branch = resolvedBranchId
        ? await tx.branch.findFirst({ where: { id: resolvedBranchId, businessId } })
        : await tx.branch.findFirst({ where: { businessId, isDefault: true } })
          ?? await tx.branch.findFirst({ where: { businessId } });
      if (branch) {
        const warehouse = await resolveBranchWarehouse(tx, businessId, branch.id);
        if (warehouse) {
          const stock = await tx.stockLevel.findFirst({ where: { itemId: id, warehouseId: warehouse.id } });
          if (stock) {
            await tx.stockLevel.update({ where: { id: stock.id }, data: { quantity: stock.quantity.add(signed) } });
          } else {
            await tx.stockLevel.create({ data: { itemId: id, warehouseId: warehouse.id, branchId: branch.id, quantity: signed } });
          }
          await tx.stockMovement.create({
            data: { businessId, itemId: id, warehouseId: warehouse.id, branchId: branch.id, type: 'ADJUSTMENT', quantity: signed, reference: adj.id, notes: body.details },
          });
        }
      }
      return adj;
    });
    this.events.emitInventoryUpdate(businessId, { itemId: id });
    return adj;
  }

  // ─── Units ─────────────────────────────────────────────────────────────────

  async listUnits(businessId: string) {
    const existing = await this.prisma.unit.findMany({ where: { businessId }, orderBy: { shortName: 'asc' } });
    if (existing.length) return existing;
    await this.prisma.unit.createMany({
      data: DEFAULT_UNITS.map((u) => ({ businessId, ...u })),
      skipDuplicates: true,
    });
    return this.prisma.unit.findMany({ where: { businessId }, orderBy: { shortName: 'asc' } });
  }

  createUnit(businessId: string, body: { name: string; shortName: string }) {
    if (!body.name?.trim() || !body.shortName?.trim()) throw new BadRequestException('Unit name and short name required');
    return this.prisma.unit.create({
      data: { businessId, name: body.name.trim(), shortName: body.shortName.trim().toUpperCase() },
    });
  }

  // ─── Barcode utilities ─────────────────────────────────────────────────────

  async generateBarcodePng(text: string): Promise<string> {
    // Lazy — the ~25MB bwip-js symbology tables only load when a label is generated.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bwipjs = require('bwip-js');
    const png = await bwipjs.toBuffer({ bcid: 'code128', text, scale: 3, height: 10, includetext: true });
    return `data:image/png;base64,${png.toString('base64')}`;
  }

  async generateQrPng(text: string): Promise<string> {
    const QRCode = await import('qrcode');
    return QRCode.toDataURL(text, { width: 256, margin: 2 });
  }

  // Build a barcode from the product details and retry with a perturbed prefix until it is
  // unique within the business (the cost suffix is preserved so labels still decode cost).
  private async generateUniqueBarcode(
    businessId: string,
    seed: { sku: string; id: string },
    cost: number,
    opts?: { excludeItemId?: string; existingPrefix?: string },
  ): Promise<string> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate =
        attempt === 0
          ? buildItemBarcode(seed, cost, opts?.existingPrefix)
          : buildItemBarcode({ sku: `${seed.sku}${attempt}`, id: seed.id }, cost);
      const clash = await this.prisma.item.findFirst({
        where: {
          businessId,
          barcode: candidate,
          deletedAt: null,
          ...(opts?.excludeItemId ? { id: { not: opts.excludeItemId } } : {}),
        },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    // Fallback: item-id digits guarantee uniqueness even if every prefix perturbation collided.
    return buildItemBarcode({ sku: seed.id.replace(/\D/g, '') || seed.id, id: seed.id }, cost);
  }

  // Generate (no barcode yet) or Regenerate (rebuild the cost suffix from the item's CURRENT cost,
  // keeping the 8-digit identity prefix so tags already on the shelf still point at this item).
  // Regenerating an item whose barcode is already in sync produces the identical value, so report
  // whether anything actually changed — writing the same row and returning it made the UI's
  // Regenerate button look like it did nothing at all.
  async assignBarcode(businessId: string, itemId: string) {
    const item = await this.get(businessId, itemId);
    const cost = Number(item.costPrice) || Number(item.purchasePrice) || 0;
    const existingPrefix = item.barcode?.replace(/\D/g, '').slice(0, BARCODE_PREFIX_LEN);
    const barcode = await this.generateUniqueBarcode(
      businessId,
      { sku: item.sku, id: item.id },
      cost,
      { excludeItemId: item.id, existingPrefix },
    );
    if (barcode === item.barcode) {
      return { ...item, barcode, changed: false, previousBarcode: item.barcode ?? null };
    }
    const updated = await this.prisma.item.update({ where: { id: itemId }, data: { barcode } });
    this.events.emitInventoryUpdate(businessId, { itemId });
    return { ...updated, changed: true, previousBarcode: item.barcode ?? null };
  }

  async bulkGenerateBarcodes(businessId: string, branchId?: string) {
    const items = await this.prisma.item.findMany({
      where: { businessId, barcode: null, deletedAt: null, ...this.branchWhere(branchId) },
    });
    const updated = [];
    for (const row of items) {
      const cost = Number(row.costPrice) || Number(row.purchasePrice) || 0;
      const barcode = buildItemBarcode({ sku: row.sku, id: row.id }, cost);
      updated.push(await this.prisma.item.update({ where: { id: row.id }, data: { barcode } }));
    }
    return updated;
  }

  // ─── Bulk import ───────────────────────────────────────────────────────────

  async import(businessId: string, rows: ItemInput[], branchId?: string) {
    const results = { created: 0, skipped: 0, errors: [] as string[] };
    for (const row of rows) {
      try {
        if (!row.name?.trim()) { results.skipped++; continue; }
        const exists = await this.prisma.item.findFirst({ where: { businessId, name: row.name.trim(), deletedAt: null } });
        if (exists) { results.skipped++; continue; }
        await this.create(businessId, row, branchId);
        results.created++;
      } catch (e) {
        results.errors.push(`${row.name}: ${(e as Error).message}`);
      }
    }
    return results;
  }
}
