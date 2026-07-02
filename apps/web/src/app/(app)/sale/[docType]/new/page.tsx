'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import { TxnForm } from '@/components/vyapar/txn-form';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { TXN_META, TxnType } from '@/lib/txn-meta';

const SALE_DOC_TYPES: Record<string, TxnType> = {
  invoices: 'SALE_INVOICE',
  estimates: 'ESTIMATE',
  'payment-in': 'PAYMENT_IN',
  orders: 'SALE_ORDER',
  challans: 'DELIVERY_CHALLAN',
  'credit-notes': 'CREDIT_NOTE',
};

export default function NewSaleDocPage({ params }: { params: Promise<{ docType: string }> }) {
  const { docType } = use(params);
  const txnType = SALE_DOC_TYPES[docType];
  if (!txnType) notFound();
  return (
    <div className="p-4 lg:p-6 space-y-4">
      <VyaparPageHeader title={`New ${TXN_META[txnType].label}`} />
      <TxnForm txnType={txnType} />
    </div>
  );
}
