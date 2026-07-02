import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface NexusDB extends DBSchema {
  products: { key: string; value: Record<string, unknown>; indexes: { 'by-barcode': string } };
  syncQueue: {
    key: string;
    value: {
      id: string;
      entity: string;
      action: string;
      payload: unknown;
      timestamp: number;
      attempts?: number;
    };
  };
}

let db: IDBPDatabase<NexusDB> | null = null;

export async function getOfflineDB() {
  if (!db) {
    db = await openDB<NexusDB>('nexus-offline', 1, {
      upgrade(database) {
        const products = database.createObjectStore('products', { keyPath: 'id' });
        products.createIndex('by-barcode', 'barcode');
        database.createObjectStore('syncQueue', { keyPath: 'id' });
      },
    });
  }
  return db;
}

export async function cacheProducts(products: Record<string, unknown>[]) {
  const database = await getOfflineDB();
  const tx = database.transaction('products', 'readwrite');
  await Promise.all(products.map((p) => tx.store.put(p)));
  await tx.done;
}

export async function queueSyncOperation(op: {
  entity: string;
  action: string;
  payload: unknown;
}) {
  const database = await getOfflineDB();
  await database.put('syncQueue', {
    id: crypto.randomUUID(),
    ...op,
    timestamp: Date.now(),
    attempts: 0,
  });
}

export async function getCachedProducts(): Promise<Record<string, unknown>[]> {
  const database = await getOfflineDB();
  return database.getAll('products');
}

export async function findCachedProductByBarcode(barcode: string) {
  const database = await getOfflineDB();
  try {
    return await database.getFromIndex('products', 'by-barcode', barcode);
  } catch {
    return undefined;
  }
}
