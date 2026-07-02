'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import { TxnForm } from '@/components/vyapar/txn-form';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { TXN_META, TxnType } from '@/lib/txn-meta';

const PURCHASE_DOC_TYPES: Record<string, TxnType> = {
  bills: 'PURCHASE_BILL',
  'payment-out': 'PAYMENT_OUT',
  orders: 'PURCHASE_ORDER',
  'debit-notes': 'DEBIT_NOTE',
};

export default function NewPurchaseDocPage({ params }: { params: Promise<{ docType: string }> }) {
  const { docType } = use(params);
  const txnType = PURCHASE_DOC_TYPES[docType];
  if (!txnType) notFound();
  return (
    <div className="p-4 lg:p-6 space-y-4">
      <VyaparPageHeader title={`New ${TXN_META[txnType].label}`} />
      <TxnForm txnType={txnType} />
    </div>
  );
}
