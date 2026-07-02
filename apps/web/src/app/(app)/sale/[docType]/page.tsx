'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import { TxnListPage } from '@/components/vyapar/txn-list-page';
import { TxnType } from '@/lib/txn-meta';

const SALE_DOC_TYPES: Record<string, TxnType> = {
  invoices: 'SALE_INVOICE',
  estimates: 'ESTIMATE',
  'payment-in': 'PAYMENT_IN',
  orders: 'SALE_ORDER',
  challans: 'DELIVERY_CHALLAN',
  'credit-notes': 'CREDIT_NOTE',
};

export default function SaleDocListPage({ params }: { params: Promise<{ docType: string }> }) {
  const { docType } = use(params);
  const txnType = SALE_DOC_TYPES[docType];
  if (!txnType) notFound();
  return <TxnListPage txnType={txnType} />;
}
