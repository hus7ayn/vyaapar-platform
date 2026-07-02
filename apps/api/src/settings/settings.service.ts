import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PREFIXES, TXN_TYPES, TxnType } from '../txns/txn.constants';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getFirmSettings(businessId: string, branchId?: string) {
    let settings = await this.prisma.firmSettings.findUnique({ where: { businessId } });
    if (!settings) {
      settings = await this.prisma.firmSettings.create({
        data: {
          businessId,
          txnPrefixes: DEFAULT_PREFIXES,
          additionalChargesConfig: [
            { name: 'Shipping', enabled: true },
            { name: 'Packaging', enabled: false },
          ],
        },
      });
    }
    const sequences = await this.prisma.txnNumberSequence.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}) },
    });
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    return { ...settings, sequences, business };
  }

  async updateFirmSettings(businessId: string, body: {
    printTheme?: string;
    termsAndConditions?: string;
    signatureUrl?: string;
    gstEnabled?: boolean;
    hsnEnabled?: boolean;
    roundOffEnabled?: boolean;
    additionalChargesConfig?: { name: string; enabled: boolean }[];
  }) {
    await this.getFirmSettings(businessId);
    return this.prisma.firmSettings.update({
      where: { businessId },
      data: {
        ...(body.printTheme !== undefined && { printTheme: body.printTheme }),
        ...(body.termsAndConditions !== undefined && { termsAndConditions: body.termsAndConditions }),
        ...(body.signatureUrl !== undefined && { signatureUrl: body.signatureUrl }),
        ...(body.gstEnabled !== undefined && { gstEnabled: body.gstEnabled }),
        ...(body.hsnEnabled !== undefined && { hsnEnabled: body.hsnEnabled }),
        ...(body.roundOffEnabled !== undefined && { roundOffEnabled: body.roundOffEnabled }),
        ...(body.additionalChargesConfig !== undefined && { additionalChargesConfig: body.additionalChargesConfig }),
      },
    });
  }

  async updateTxnNumbering(businessId: string, branchId: string | undefined, body: { txnType: string; prefix: string; nextNumber?: number }) {
    if (!TXN_TYPES.includes(body.txnType as TxnType)) {
      throw new BadRequestException(`Invalid transaction type: ${body.txnType}`);
    }
    if (!branchId) throw new BadRequestException('Select a shop to configure numbering');
    const seq = await this.prisma.txnNumberSequence.upsert({
      where: { businessId_branchId_txnType: { businessId, branchId, txnType: body.txnType } },
      create: {
        businessId,
        branchId,
        txnType: body.txnType,
        prefix: body.prefix,
        nextNumber: body.nextNumber ?? 1,
      },
      update: {
        prefix: body.prefix,
        ...(body.nextNumber !== undefined && { nextNumber: body.nextNumber }),
      },
    });

    const settings = await this.getFirmSettings(businessId, branchId);
    const prefixes = { ...((settings.txnPrefixes as Record<string, string>) ?? {}), [body.txnType]: body.prefix };
    await this.prisma.firmSettings.update({ where: { businessId }, data: { txnPrefixes: prefixes } });

    return seq;
  }
}
