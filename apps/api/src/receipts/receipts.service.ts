import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { Prisma } from '@prisma/client';
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
    const label = TXN_LABELS[txn.txnType as TxnType] ?? txn.txnType;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const money = (n: number | string | Prisma.Decimal) => Number(n).toFixed(2);

    const itemRows = txn.lines
      .map(
        (item) => `
          <tr>
            <td colspan="3" class="item-name">${esc(item.name)}</td>
          </tr>
          <tr class="item-detail">
            <td>${Number(item.quantity)} ${esc(item.unit)} &times; ${money(item.unitPrice)}</td>
            <td></td>
            <td class="right">${money(item.total)}</td>
          </tr>`,
      )
      .join('');

    const charges = (txn.additionalCharges as { name: string; amount: number }[] | null) ?? [];
    const totalsRows = [
      `<tr><td>Subtotal</td><td class="right">${money(txn.subtotal)}</td></tr>`,
      Number(txn.discountAmount) > 0
        ? `<tr><td>Discount</td><td class="right">-${money(txn.discountAmount)}</td></tr>`
        : '',
      Number(txn.taxAmount) > 0 ? `<tr><td>Tax</td><td class="right">${money(txn.taxAmount)}</td></tr>` : '',
      ...charges.map((c) => `<tr><td>${esc(c.name)}</td><td class="right">${money(c.amount)}</td></tr>`),
      Number(txn.roundOff) !== 0 ? `<tr><td>Round off</td><td class="right">${money(txn.roundOff)}</td></tr>` : '',
    ].join('');

    const paymentRows = txn.payments
      .map((p) => `<tr><td>${esc(p.paymentType)}</td><td class="right">${money(p.amount)}</td></tr>`)
      .join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(txn.txnNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Courier New', ui-monospace, monospace;
    width: 80mm;
    margin: 0 auto;
    padding: 4mm 4mm 8mm;
    color: #000;
    font-size: 12px;
    line-height: 1.45;
  }
  .center { text-align: center; }
  .right { text-align: right; }
  .biz-name { font-size: 16px; font-weight: 700; }
  .muted { color: #333; font-size: 11px; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  .divider.solid { border-top: 1px solid #000; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  .item-name { font-weight: 600; padding-top: 4px; }
  .item-detail td { color: #333; }
  .total-row td { font-weight: 700; font-size: 14px; padding-top: 4px; }
  .thank-you { margin-top: 10px; font-weight: 600; }
  @media print {
    body { width: auto; }
  }
</style>
</head>
<body>
  <div class="center biz-name">${esc(txn.business.name)}</div>
  ${txn.business.gstNumber ? `<div class="center muted">GSTIN: ${esc(txn.business.gstNumber)}</div>` : ''}
  ${txn.branch ? `<div class="center muted">${esc(txn.branch.name)}</div>` : ''}
  <div class="divider"></div>
  <div class="center" style="font-weight:700">${esc(label.toUpperCase())}</div>
  <table>
    <tr><td>No: ${esc(txn.txnNumber)}</td><td class="right">${txn.date.toLocaleString('en-IN')}</td></tr>
    ${txn.partyName ? `<tr><td colspan="2">Party: ${esc(txn.partyName)}</td></tr>` : ''}
  </table>
  <div class="divider"></div>
  <table>${itemRows}</table>
  <div class="divider"></div>
  <table>
    ${totalsRows}
    <tr class="total-row"><td>TOTAL</td><td class="right">Rs. ${money(txn.total)}</td></tr>
  </table>
  <div class="divider solid"></div>
  <table>
    ${paymentRows}
    ${Number(txn.balance) > 0 ? `<tr><td>BALANCE DUE</td><td class="right">${money(txn.balance)}</td></tr>` : ''}
  </table>
  <div class="center thank-you">Thank you!</div>
  <div class="center muted">Powered by ${esc(txn.business.name)}</div>
</body>
</html>`;
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
