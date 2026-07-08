'use client';

import { useState } from 'react';
import { Printer, FileText, MessageCircle, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Txn } from '@/lib/txn-meta';

export function ReceiptActions({ txnId }: { txnId: string }) {
  const token = useAuthStore((s) => s.accessToken)!;
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const printThermal = async () => {
    const res = await api<{ content: string }>(`/receipts/${txnId}/thermal`, { token });
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(res.content);
      w.document.close();
      w.onload = () => w.print();
    }
    toast.success('Receipt sent to printer');
  };

  const printPdf = async () => {
    toast.loading('Generating receipt...', { id: 'print-pdf' });
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/v1/receipts/${txnId}/pdf`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        iframe.contentWindow?.print();
        toast.success('Sent to printer', { id: 'print-pdf' });
      };
    } catch {
      toast.error('Failed to print receipt', { id: 'print-pdf' });
    }
  };

  const sendWhatsApp = async () => {
    if (!phone) return toast.error('Enter phone number');
    toast.loading('Preparing WhatsApp message...', { id: 'whatsapp-share' });
    try {
      const txn = await api<Txn>(`/txns/${txnId}`, { token });
      const itemsStr = (txn.lines ?? [])
        .map((item) => `• ${item.name} (${item.quantity}x) - ₹${Number(item.total ?? Number(item.unitPrice) * Number(item.quantity)).toFixed(2)}`)
        .join('\n');
      const paymentsStr = (txn.payments ?? [])
        .map((p) => `• ${p.paymentType}: ₹${Number(p.amount).toFixed(2)}`)
        .join('\n');
      const message =
        `*🧾 RECEIPT*\n` +
        `*Invoice:* ${txn.txnNumber}\n` +
        `*Date:* ${new Date(txn.date).toLocaleDateString()}\n` +
        `*Customer:* ${txn.partyName ?? 'Walk-in'}\n\n` +
        `*Items:*\n${itemsStr}\n\n` +
        `*Total:* ₹${Number(txn.total).toFixed(2)}\n` +
        (paymentsStr ? `*Payments:*\n${paymentsStr}\n` : '') +
        `Thank you!`;
      const cleanPhone = phone.replace(/\D/g, '');
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
      toast.success('WhatsApp link generated!', { id: 'whatsapp-share' });
    } catch {
      toast.error('Failed to generate WhatsApp link', { id: 'whatsapp-share' });
    }
  };

  const sendEmail = async () => {
    if (!email) return toast.error('Enter email');
    await api(`/receipts/${txnId}/email`, {
      method: 'POST',
      token,
      body: JSON.stringify({ email }),
    });
    toast.success('Email receipt sent');
  };

  return (
    <div className="space-y-3 p-4 border rounded-xl bg-secondary/30">
      <p className="text-sm font-semibold">Receipt</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={printThermal}>
          <Printer className="h-4 w-4 mr-1" /> Thermal
        </Button>
        <Button variant="outline" size="sm" onClick={printPdf}>
          <FileText className="h-4 w-4 mr-1" /> PDF Print
        </Button>
      </div>
      <div className="flex gap-2">
        <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button size="sm" variant="outline" onClick={sendWhatsApp}>
          <MessageCircle className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex gap-2">
        <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button size="sm" variant="outline" onClick={sendEmail}>
          <Mail className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
