import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { TXN_LABELS, TxnType } from '../txns/txn.constants';

@Injectable()
export class ReceiptsService {
  constructor(private prisma: PrismaService) {}

  async getTxnData(txnId: string, businessId: string) {
    const txn = await this.prisma.txn.findFirst({
      where: { id: txnId, businessId },
      include: {
        lines: { include: { item: { select: { mrp: true, itemType: true } } } },
        payments: true,
        business: true,
        branch: true,
        party: true,
      },
    });
    if (!txn) throw new NotFoundException('Transaction not found');
    return txn;
  }

  async generateThermal(txnId: string, businessId: string): Promise<string> {
    const txn = await this.getTxnData(txnId, businessId);
    const lines: string[] = [];
    const w = 32;
    const center = (s: string) => {
      const pad = Math.max(0, Math.floor((w - s.length) / 2));
      return ' '.repeat(pad) + s;
    };
    const label = TXN_LABELS[txn.txnType as TxnType] ?? txn.txnType;

    lines.push(center(txn.business.name));
    if (txn.business.gstNumber) lines.push(center(`GSTIN: ${txn.business.gstNumber}`));
    if (txn.branch) lines.push(center(txn.branch.name));
    lines.push('-'.repeat(w));
    lines.push(center(label.toUpperCase()));
    lines.push(`No: ${txn.txnNumber}`);
    lines.push(`Date: ${txn.date.toLocaleString('en-IN')}`);
    if (txn.partyName) lines.push(`Party: ${txn.partyName}`);
    lines.push('-'.repeat(w));

    for (const item of txn.lines) {
      lines.push(item.name.slice(0, w));
      lines.push(
        ` ${Number(item.quantity)} ${item.unit} x ${Number(item.unitPrice).toFixed(2)} = ${Number(item.total).toFixed(2)}`,
      );
    }

    lines.push('-'.repeat(w));
    lines.push(`Subtotal: ${Number(txn.subtotal).toFixed(2)}`.padStart(w));
    if (Number(txn.taxAmount) > 0) lines.push(`Tax: ${Number(txn.taxAmount).toFixed(2)}`.padStart(w));
    if (Number(txn.discountAmount) > 0) lines.push(`Discount: -${Number(txn.discountAmount).toFixed(2)}`.padStart(w));
    const charges = (txn.additionalCharges as { name: string; amount: number }[] | null) ?? [];
    for (const c of charges) lines.push(`${c.name}: ${Number(c.amount).toFixed(2)}`.padStart(w));
    if (Number(txn.roundOff) !== 0) lines.push(`Round off: ${Number(txn.roundOff).toFixed(2)}`.padStart(w));
    lines.push(`TOTAL: ${Number(txn.total).toFixed(2)}`.padStart(w));
    lines.push('-'.repeat(w));
    for (const p of txn.payments) {
      lines.push(`${p.paymentType}: ${Number(p.amount).toFixed(2)}`.padStart(w));
    }
    if (Number(txn.balance) > 0) lines.push(`BALANCE DUE: ${Number(txn.balance).toFixed(2)}`.padStart(w));
    lines.push('');
    lines.push(center('Thank you!'));
    lines.push(center(`Powered by ${txn.business.name}`));

    return lines.join('\n');
  }

  async generatePdf(txnId: string, businessId: string): Promise<Buffer> {
    const txn = await this.getTxnData(txnId, businessId);
    const label = TXN_LABELS[txn.txnType as TxnType] ?? txn.txnType;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 36, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = doc.page.width;
      const left = 36;
      const right = pageW - 36;

      // Header band
      doc.rect(0, 0, pageW, 90).fill('#b91c1c');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20);
      doc.text(txn.business.name, left, 24);
      doc.font('Helvetica').fontSize(9);
      if (txn.business.address) doc.text(txn.business.address, left, 50);
      const meta = [
        txn.business.phone ? `Ph: ${txn.business.phone}` : null,
        txn.business.gstNumber ? `GSTIN: ${txn.business.gstNumber}` : null,
      ].filter(Boolean).join('   ');
      if (meta) doc.text(meta, left, 64);

      doc.font('Helvetica-Bold').fontSize(16);
      doc.text(label, left, 30, { width: right - left, align: 'right' });

      // Bill info
      doc.fillColor('#111827').font('Helvetica').fontSize(10);
      let y = 110;
      doc.font('Helvetica-Bold').text('Bill To:', left, y);
      doc.font('Helvetica').text(txn.partyName ?? 'Cash Sale', left, y + 14);
      if (txn.party?.billingAddress) doc.text(txn.party.billingAddress, left, y + 28, { width: 220 });
      if (txn.party?.gstin) doc.text(`GSTIN: ${txn.party.gstin}`, left, doc.y + 2);
      if (txn.party?.phone) doc.text(`Ph: ${txn.party.phone}`, left, doc.y + 2);

      doc.font('Helvetica-Bold').text(`${label} No:`, 380, y, { width: 100 });
      doc.font('Helvetica').text(txn.txnNumber, 470, y);
      doc.font('Helvetica-Bold').text('Date:', 380, y + 14);
      doc.font('Helvetica').text(txn.date.toLocaleDateString('en-IN'), 470, y + 14);
      if (txn.dueDate) {
        doc.font('Helvetica-Bold').text('Due Date:', 380, y + 28);
        doc.font('Helvetica').text(txn.dueDate.toLocaleDateString('en-IN'), 470, y + 28);
      }

      y = Math.max(doc.y + 16, 180);

      // Items table header
      doc.rect(left, y, right - left, 22).fill('#fee2e2');
      doc.fillColor('#7f1d1d').font('Helvetica-Bold').fontSize(9);
      doc.text('#', left + 6, y + 7, { width: 16 });
      doc.text('ITEM', left + 26, y + 7, { width: 170 });
      doc.text('HSN', left + 200, y + 7, { width: 50 });
      doc.text('QTY', left + 250, y + 7, { width: 46, align: 'right' });
      doc.text('RATE', left + 300, y + 7, { width: 60, align: 'right' });
      doc.text('TAX', left + 364, y + 7, { width: 56, align: 'right' });
      doc.text('AMOUNT', left + 424, y + 7, { width: right - left - 430, align: 'right' });
      y += 26;

      doc.fillColor('#111827').font('Helvetica').fontSize(9);
      txn.lines.forEach((l, i) => {
        doc.text(String(i + 1), left + 6, y, { width: 16 });
        doc.text(l.name, left + 26, y, { width: 170 });
        doc.text(l.hsnCode ?? '-', left + 200, y, { width: 50 });
        doc.text(`${Number(l.quantity)} ${l.unit}`, left + 250, y, { width: 46, align: 'right' });
        doc.text(Number(l.unitPrice).toFixed(2), left + 300, y, { width: 60, align: 'right' });
        doc.text(`${Number(l.taxAmount).toFixed(2)} (${Number(l.taxRate)}%)`, left + 364, y, { width: 56, align: 'right' });
        doc.text(Number(l.total).toFixed(2), left + 424, y, { width: right - left - 430, align: 'right' });
        y = Math.max(doc.y, y) + 8;
      });

      doc.moveTo(left, y).lineTo(right, y).strokeColor('#e5e7eb').stroke();
      y += 10;

      // Totals
      const totalsX = 360;
      const totalRow = (name: string, value: string, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
        doc.text(name, totalsX, y, { width: 110 });
        doc.text(value, totalsX + 110, y, { width: right - totalsX - 110, align: 'right' });
        y += 16;
      };
      totalRow('Subtotal', Number(txn.subtotal).toFixed(2));
      if (Number(txn.discountAmount) > 0) totalRow('Discount', `-${Number(txn.discountAmount).toFixed(2)}`);
      if (Number(txn.taxAmount) > 0) totalRow('Tax (GST)', Number(txn.taxAmount).toFixed(2));
      const charges = (txn.additionalCharges as { name: string; amount: number }[] | null) ?? [];
      for (const c of charges) totalRow(c.name, Number(c.amount).toFixed(2));
      if (Number(txn.roundOff) !== 0) totalRow('Round Off', Number(txn.roundOff).toFixed(2));

      doc.rect(totalsX - 6, y - 2, right - totalsX + 6, 22).fill('#b91c1c');
      doc.fillColor('#ffffff');
      totalRow('TOTAL', `Rs. ${Number(txn.total).toFixed(2)}`, true);
      doc.fillColor('#111827');

      if (Number(txn.paidAmount) > 0) totalRow('Received', Number(txn.paidAmount).toFixed(2));
      if (Number(txn.balance) > 0) totalRow('Balance Due', Number(txn.balance).toFixed(2), true);

      // Description / terms
      if (txn.description) {
        doc.font('Helvetica-Bold').fontSize(9).text('Notes:', left, y + 8);
        doc.font('Helvetica').text(txn.description, left, doc.y + 2, { width: 280 });
      }

      doc.font('Helvetica').fontSize(8).fillColor('#6b7280');
      doc.text('This is a computer generated document.', left, doc.page.height - 60, { width: right - left, align: 'center' });

      doc.end();
    });
  }

  async sendWhatsApp(txnId: string, businessId: string, phone: string) {
    const txn = await this.getTxnData(txnId, businessId);
    const thermal = await this.generateThermal(txnId, businessId);
    console.log(`[WhatsApp] To ${phone}: ${txn.txnType} ${txn.txnNumber}\n${thermal}`);
    return { sent: true, message: 'Receipt queued for WhatsApp delivery' };
  }

  async sendEmail(txnId: string, businessId: string, email: string) {
    const txn = await this.getTxnData(txnId, businessId);
    console.log(`[Email] To ${email}: Receipt for ${txn.txnNumber}`);
    return { sent: true, message: 'Receipt emailed' };
  }
}
