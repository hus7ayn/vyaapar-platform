'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import { TxnListPage } from '@/components/vyapar/txn-list-page';
import { TxnType } from '@/lib/txn-meta';

const PURCHASE_DOC_TYPES: Record<string, TxnType> = {
  bills: 'PURCHASE_BILL',
  'payment-out': 'PAYMENT_OUT',
  orders: 'PURCHASE_ORDER',
  'debit-notes': 'DEBIT_NOTE',
};

export default function PurchaseDocListPage({ params }: { params: Promise<{ docType: string }> }) {
  const { docType } = use(params);
  const txnType = PURCHASE_DOC_TYPES[docType];
  if (!txnType) notFound();
  return <TxnListPage txnType={txnType} />;
}
