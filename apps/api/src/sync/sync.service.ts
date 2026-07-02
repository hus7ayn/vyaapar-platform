import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SaleService } from '../sale/sale.service';
import { CreateTxnInput } from '../txns/txn-core.service';

@Injectable()
export class SyncService {
  constructor(
    private prisma: PrismaService,
    private sale: SaleService,
  ) {}

  async pushOperations(
    businessId: string,
    branchId: string,
    userId: string,
    clientId: string,
    operations: Array<{ entity: string; action: string; payload: Record<string, unknown> }>,
  ) {
    const results: unknown[] = [];

    for (const op of operations) {
      await this.prisma.syncQueue.create({
        data: {
          businessId,
          clientId,
          entity: op.entity,
          action: op.action,
          payload: op.payload as never,
          status: 'PENDING',
        },
      });

      if ((op.entity === 'order' || op.entity === 'sale_invoice') && op.action === 'create') {
        const payload = op.payload as Partial<CreateTxnInput> & { clientId?: string };
        // Idempotency: skip if this client txn already synced
        const existing = await this.prisma.txn.findFirst({
          where: { businessId, clientId: payload.clientId ?? clientId, txnType: 'SALE_INVOICE' },
        });
        const invoice = existing ?? await this.sale.createInvoice(businessId, userId, {
          ...(payload as Omit<CreateTxnInput, 'txnType'>),
          branchId,
          clientId: payload.clientId ?? clientId,
        });
        results.push(invoice);
        await this.prisma.syncQueue.updateMany({
          where: { businessId, clientId, entity: op.entity, status: 'PENDING' },
          data: { status: 'PROCESSED', processedAt: new Date() },
        });
      }
    }

    return { synced: results.length, results };
  }

  getPending(businessId: string, clientId: string) {
    return this.prisma.syncQueue.findMany({
      where: { businessId, clientId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
  }
}
