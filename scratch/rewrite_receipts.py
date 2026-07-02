import re

def rewrite():
    with open('apps/api/src/receipts/receipts.service.ts', 'r') as f:
        content = f.read()

    new_content = """import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReceiptsService {
  constructor(private prisma: PrismaService) {}

  async getOrderData(orderId: string, businessId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, businessId },
      include: {
        items: {
          include: { product: true }
        },
        payments: true,
        business: true,
        branch: true,
        customer: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async generateThermal(orderId: string, businessId: string): Promise<string> {
    const order = await this.getOrderData(orderId, businessId);
    const lines: string[] = [];
    const w = 32;
    const center = (s: string) => {
      const pad = Math.max(0, Math.floor((w - s.length) / 2));
      return ' '.repeat(pad) + s;
    };

    lines.push(center(order.business.name));
    if (order.business.gstNumber) lines.push(center(`GST: ${order.business.gstNumber}`));
    lines.push(center(order.branch.name));
    lines.push('-'.repeat(w));
    lines.push(`Invoice: ${order.orderNumber}`);
    lines.push(`Date: ${order.createdAt.toLocaleString('en-IN')}`);
    if (order.customer) lines.push(`Customer: ${order.customer.name}`);
    lines.push('-'.repeat(w));

    for (const item of order.items) {
      lines.push(item.name.slice(0, w));
      lines.push(
        ` ${item.quantity} x ${Number(item.unitPrice).toFixed(2)} = ${Number(item.total).toFixed(2)}`,
      );
    }

    lines.push('-'.repeat(w));
    lines.push(`Subtotal: ${Number(order.subtotal).toFixed(2)}`.padStart(w));
    lines.push(`Tax: ${Number(order.taxAmount).toFixed(2)}`.padStart(w));
    if (Number(order.discountAmount) > 0) {
      lines.push(`Discount: -${Number(order.discountAmount).toFixed(2)}`.padStart(w));
    }
    lines.push(`TOTAL: ${Number(order.total).toFixed(2)}`.padStart(w));
    lines.push('-'.repeat(w));
    for (const p of order.payments) {
      lines.push(`${p.method}: ${Number(p.amount).toFixed(2)}`.padStart(w));
    }
    lines.push('');
    lines.push(center('Thank you!'));
    lines.push(center('Powered by Nexus Platform'));

    return lines.join('\\n');
  }

  async generatePdf(orderId: string, businessId: string): Promise<Buffer> {
    const order = await this.getOrderData(orderId, businessId);
    
    return new Promise((resolve, reject) => {
      // Modern Retail Receipt styling
      const doc = new PDFDocument({ margin: 20, size: [300, 800] });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const drawDivider = () => {
        doc.lineWidth(1).moveTo(20, doc.y).lineTo(280, doc.y).strokeColor('#dddddd').stroke();
        doc.moveDown(0.5);
      };

      // Header Box
      doc.rect(20, 20, 260, 80).fillAndStroke('#f8fafc', '#e2e8f0');
      doc.fillColor('#0f172a');
      
      doc.font('Helvetica-Bold').fontSize(16);
      doc.text(order.business.name.toUpperCase(), 20, 35, { align: 'center', width: 260 });
      
      doc.font('Helvetica').fontSize(10);
      const address = order.branch.address || 'Address Not Set';
      doc.text(address, 20, doc.y + 2, { align: 'center', width: 260 });
      if (order.business.phone) doc.text(`Ph: ${order.business.phone}`, { align: 'center', width: 260 });
      if (order.business.gstNumber) doc.text(`GSTIN: ${order.business.gstNumber}`, { align: 'center', width: 260 });
      
      doc.y = 110;
      doc.fillColor('#334155');

      // Bill Info
      const dateStr = order.createdAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute:'2-digit' });
      doc.font('Helvetica').fontSize(10);
      doc.text(`Invoice: `, 20, doc.y, { continued: true }).font('Helvetica-Bold').text(`${order.orderNumber}`);
      doc.font('Helvetica').text(`Date:    `, 20, doc.y).font('Helvetica-Bold').text(dateStr, 60, doc.y - 12);
      
      if (order.customer) {
        doc.font('Helvetica').text(`Customer: `, 20, doc.y + 4).font('Helvetica-Bold').text(order.customer.name, 75, doc.y - 12);
      }

      doc.moveDown(1);
      drawDivider();

      // Table Header
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569');
      const startY = doc.y;
      doc.text('ITEM & DESC', 20, startY, { width: 120 });
      doc.text('QTY', 140, startY, { width: 30, align: 'right' });
      doc.text('RATE', 170, startY, { width: 50, align: 'right' });
      doc.text('AMOUNT', 220, startY, { width: 60, align: 'right' });
      
      doc.moveDown(0.5);
      drawDivider();
      
      // Items
      doc.font('Helvetica').fillColor('#0f172a');
      let totalQty = 0;
      let totalSavings = 0;
      let baseSubtotal = 0;
      
      order.items.forEach((item, index) => {
        const qty = Number(item.quantity);
        const price = Number(item.unitPrice);
        const amt = Number(item.total);
        const mrp = Number(item.product?.mrp || price);
        const savings = (mrp - price) * qty;
        
        baseSubtotal += (price * qty);
        totalQty += qty;
        if (savings > 0) totalSavings += savings;
        
        const y = doc.y;
        
        // Item Details
        let desc = item.name;
        if (item.product?.color || item.product?.size) {
            desc += `\\nSize: ${item.product.size || '-'} | Color: ${item.product.color || '-'}`;
        }
        if (item.product?.itemCode) {
            desc += `\\nCode: ${item.product.itemCode}`;
        }

        doc.text(desc, 20, y, { width: 120 });
        const textHeight = doc.heightOfString(desc, { width: 120 });
        
        doc.text(`${qty}`, 140, y, { width: 30, align: 'right' });
        doc.text(price.toFixed(2), 170, y, { width: 50, align: 'right' });
        doc.text(amt.toFixed(2), 220, y, { width: 60, align: 'right' });
        
        if (mrp > price) {
          doc.font('Helvetica-Oblique').fontSize(8).fillColor('#10b981');
          doc.text(`MRP: ${mrp.toFixed(2)} | Save: ${(mrp - price).toFixed(2)}/ea`, 170, y + textHeight, { width: 110, align: 'right' });
          doc.font('Helvetica').fontSize(9).fillColor('#0f172a');
          doc.moveDown(0.5);
        }
        doc.y = Math.max(doc.y, y + textHeight) + 5;
      });
      
      drawDivider();
      
      // Totals Area
      const totalsY = doc.y + 5;
      doc.font('Helvetica').fontSize(10);
      doc.text('Total Qty', 20, totalsY, { width: 100 });
      doc.font('Helvetica-Bold').text(`${totalQty}`, 140, totalsY, { width: 30, align: 'right' });
      
      doc.font('Helvetica').text('Subtotal', 160, totalsY, { width: 60 });
      doc.font('Helvetica-Bold').text(`${baseSubtotal.toFixed(2)}`, 220, totalsY, { width: 60, align: 'right' });

      let currentY = doc.y + 5;
      
      if (Number(order.taxAmount) > 0) {
        doc.font('Helvetica').text('Tax (GST)', 160, currentY, { width: 60 });
        doc.text(`${Number(order.taxAmount).toFixed(2)}`, 220, currentY, { width: 60, align: 'right' });
        currentY = doc.y + 5;
      }
      
      if (Number(order.discountAmount) > 0) {
        doc.font('Helvetica').fillColor('#ef4444').text('Discount', 160, currentY, { width: 60 });
        doc.text(`-${Number(order.discountAmount).toFixed(2)}`, 220, currentY, { width: 60, align: 'right' });
        doc.fillColor('#0f172a');
        currentY = doc.y + 5;
      }

      doc.y = currentY;
      drawDivider();
      
      // GRAND TOTAL Highlight
      doc.rect(140, doc.y, 140, 25).fill('#f1f5f9');
      doc.fillColor('#0f172a');
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text('NET TOTAL', 150, doc.y + 6, { width: 60 });
      doc.text(`₹ ${Number(order.total).toFixed(2)}`, 210, doc.y - 14, { width: 65, align: 'right' });
      
      doc.y += 15;

      if (totalSavings > 0) {
        doc.rect(20, doc.y, 260, 20).fill('#ecfdf5');
        doc.fillColor('#059669').font('Helvetica-Bold').fontSize(10);
        doc.text(`🎉 You saved ₹ ${totalSavings.toFixed(2)} on this bill!`, 20, doc.y + 5, { align: 'center', width: 260 });
        doc.y += 15;
      }

      // Footer Message
      doc.moveDown(2);
      doc.fillColor('#64748b').font('Helvetica').fontSize(9);
      doc.text('Thank you for shopping with us!', { align: 'center' });
      doc.text('Please keep this receipt for returns/exchanges.', { align: 'center' });
      doc.moveDown(1);
      doc.text('~ Nexus POS System ~', { align: 'center', fontSize: 8 });

      doc.end();
    });
  }

  async sendWhatsApp(orderId: string, businessId: string, phone: string) {
    const order = await this.getOrderData(orderId, businessId);
    const thermal = await this.generateThermal(orderId, businessId);
    console.log(`[WhatsApp] To ${phone}: Order ${order.orderNumber}\\n${thermal}`);
    return { sent: true, message: 'Receipt queued for WhatsApp delivery' };
  }

  async sendEmail(orderId: string, businessId: string, email: string) {
    const order = await this.getOrderData(orderId, businessId);
    console.log(`[Email] To ${email}: Receipt for ${order.orderNumber}`);
    return { sent: true, message: 'Receipt emailed' };
  }
}
"""
    with open('apps/api/src/receipts/receipts.service.ts', 'w') as f:
        f.write(new_content)

if __name__ == '__main__':
    rewrite()
