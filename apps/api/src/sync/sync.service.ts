import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaleService } from '../sale/sale.service';
import { CreateTxnInput } from '../txns/txn-core.service';

type Op = { entity: string; action: string; payload: Record<string, unknown> };

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private prisma: PrismaService,
    private sale: SaleService,
  ) {}

  // A permanent (client/data) error will never succeed on retry — dead-letter it so a single
  // poison row can't wedge the queue forever (the "Syncing N sale(s)…" that never clears).
  // Transient errors (5xx, DB connection, timeout) bubble up so the batch retries later.
  private isPermanent(err: unknown): boolean {
    if (err instanceof HttpException) {
      const s = err.getStatus();
      return s >= 400 && s < 500;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      return ['P2002', 'P2003', 'P2025'].includes(err.code);
    }
    if (err instanceof Prisma.PrismaClientValidationError) return true;
    return false;
  }

  private recordOp(businessId: string, clientId: string, op: Op, status: string, error?: string) {
    return this.prisma.syncQueue.create({
      data: {
        businessId,
        clientId,
        entity: op.entity,
        action: op.action,
        payload: op.payload as never,
        status,
        error: error ?? null,
        processedAt: new Date(),
      },
    });
  }

  async pushOperations(
    businessId: string,
    branchId: string,
    userId: string,
    clientId: string,
    operations: Op[],
  ) {
    const results: unknown[] = [];
    let skipped = 0;

    for (const op of operations) {
      const isSaleCreate =
        (op.entity === 'order' || op.entity === 'sale_invoice') && op.action === 'create';

      if (!isSaleCreate) {
        // Nothing to materialise for other entity types today — record for audit and move on
        // so the client can safely clear the row.
        await this.recordOp(businessId, clientId, op, 'PROCESSED');
        continue;
      }

      const payload = op.payload as Partial<CreateTxnInput> & { clientId?: string };
      const opClientId = payload.clientId ?? clientId;

      try {
        // Idempotency: never create a duplicate for a client txn that already synced (e.g. the
        // sale saved online but was also queued offline, or a batch retried after partial success).
        const existing = await this.prisma.txn.findFirst({
          where: { businessId, clientId: opClientId, txnType: 'SALE_INVOICE' },
        });
        const invoice =
          existing ??
          (await this.sale.createInvoice(businessId, userId, {
            ...(payload as Omit<CreateTxnInput, 'txnType'>),
            branchId,
            clientId: opClientId,
          }));
        results.push(invoice);
        await this.recordOp(businessId, clientId, op, 'PROCESSED');
      } catch (err) {
        if (this.isPermanent(err)) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Dropping permanently-failing sync op (${op.entity}/${op.action}): ${message}`,
          );
          await this.recordOp(businessId, clientId, op, 'FAILED', message);
          skipped++;
          continue;
        }
        // Transient — abort the batch so the client keeps the rows and retries. Ops already
        // processed above are guarded by the idempotency check on the next attempt.
        throw err;
      }
    }

    return { synced: results.length, skipped, results };
  }

  getPending(businessId: string, clientId: string) {
    return this.prisma.syncQueue.findMany({
      where: { businessId, clientId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
  }
}
