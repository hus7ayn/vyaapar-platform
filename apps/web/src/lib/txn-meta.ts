export type TxnType =
  | 'SALE_INVOICE'
  | 'CREDIT_NOTE'
  | 'SALE_ORDER'
  | 'DELIVERY_CHALLAN'
  | 'ESTIMATE'
  | 'PAYMENT_IN'
  | 'PURCHASE_BILL'
  | 'DEBIT_NOTE'
  | 'PURCHASE_ORDER'
  | 'PAYMENT_OUT'
  | 'EXPENSE'
  | 'P2P_TRANSFER';

export interface TxnLine {
  id?: string;
  itemId?: string | null;
  name: string;
  hsnCode?: string | null;
  quantity: number | string;
  unit: string;
  unitPrice: number | string;
  discountPercent?: number | string | null;
  discountAmount?: number | string;
  taxRate: number | string;
  taxAmount?: number | string;
  total?: number | string;
}

export interface Txn {
  id: string;
  txnType: TxnType;
  txnNumber: string;
  partyId?: string | null;
  partyName?: string | null;
  date: string;
  dueDate?: string | null;
  subtotal: string | number;
  discountAmount: string | number;
  taxAmount: string | number;
  additionalCharges?: { name: string; amount: number }[] | null;
  roundOff: string | number;
  total: string | number;
  paidAmount: string | number;
  balance: string | number;
  status: string;
  description?: string | null;
  lines?: TxnLine[];
  payments?: { id: string; paymentType: string; amount: string | number; bankAccountId?: string | null }[];
  party?: { id: string; name: string; phone?: string | null } | null;
  expenseCategory?: { id: string; name: string } | null;
  sourceTxn?: { id: string; txnType: string; txnNumber: string } | null;
  convertedTxns?: { id: string; txnType: string; txnNumber: string }[];
  createdAt?: string;
}

export interface TxnMeta {
  type: TxnType;
  label: string;
  labelPlural: string;
  listPath: string;
  createEndpoint: string;
  listEndpoint: string;
  partyLabel: string;
  partyType?: 'CUSTOMER' | 'SUPPLIER';
  side: 'sale' | 'purchase' | 'other';
  hasLines: boolean;
  paymentLabel: string;
  convertEndpoint?: (id: string) => string;
  convertLabel?: string;
  isOrder?: boolean;
  color: string;
}

export const TXN_META: Record<TxnType, TxnMeta> = {
  SALE_INVOICE: {
    type: 'SALE_INVOICE', label: 'Sale Invoice', labelPlural: 'Sale Invoices',
    listPath: '/sale/invoices', createEndpoint: '/sale/invoices', listEndpoint: '/sale/invoices',
    partyLabel: 'Customer', partyType: 'CUSTOMER', side: 'sale', hasLines: true, paymentLabel: 'Received',
    color: 'text-red-600 bg-red-50',
  },
  CREDIT_NOTE: {
    type: 'CREDIT_NOTE', label: 'Credit Note', labelPlural: 'Credit Notes (Sale Return)',
    listPath: '/sale/credit-notes', createEndpoint: '/sale/credit-notes', listEndpoint: '/sale/credit-notes',
    partyLabel: 'Customer', partyType: 'CUSTOMER', side: 'sale', hasLines: true, paymentLabel: 'Paid Back',
    color: 'text-orange-600 bg-orange-50',
  },
  ESTIMATE: {
    type: 'ESTIMATE', label: 'Estimate', labelPlural: 'Estimates / Quotations',
    listPath: '/sale/estimates', createEndpoint: '/sale/estimates', listEndpoint: '/sale/estimates',
    partyLabel: 'Customer', partyType: 'CUSTOMER', side: 'sale', hasLines: true, paymentLabel: 'Advance',
    convertEndpoint: (id) => `/sale/estimates/${id}/convert`, convertLabel: 'Convert to Sale', isOrder: true,
    color: 'text-blue-600 bg-blue-50',
  },
  SALE_ORDER: {
    type: 'SALE_ORDER', label: 'Sale Order', labelPlural: 'Sale Orders',
    listPath: '/sale/orders', createEndpoint: '/sale/orders', listEndpoint: '/sale/orders',
    partyLabel: 'Customer', partyType: 'CUSTOMER', side: 'sale', hasLines: true, paymentLabel: 'Advance',
    convertEndpoint: (id) => `/sale/orders/${id}/convert`, convertLabel: 'Convert to Sale', isOrder: true,
    color: 'text-purple-600 bg-purple-50',
  },
  DELIVERY_CHALLAN: {
    type: 'DELIVERY_CHALLAN', label: 'Delivery Challan', labelPlural: 'Delivery Challans',
    listPath: '/sale/challans', createEndpoint: '/sale/challans', listEndpoint: '/sale/challans',
    partyLabel: 'Customer', partyType: 'CUSTOMER', side: 'sale', hasLines: true, paymentLabel: 'Received',
    convertEndpoint: (id) => `/sale/challans/${id}/convert`, convertLabel: 'Convert to Sale', isOrder: true,
    color: 'text-teal-600 bg-teal-50',
  },
  PAYMENT_IN: {
    type: 'PAYMENT_IN', label: 'Payment In', labelPlural: 'Payments In',
    listPath: '/sale/payment-in', createEndpoint: '/sale/payments-in', listEndpoint: '/sale/payments-in',
    partyLabel: 'Customer', partyType: 'CUSTOMER', side: 'sale', hasLines: false, paymentLabel: 'Received',
    color: 'text-green-600 bg-green-50',
  },
  PURCHASE_BILL: {
    type: 'PURCHASE_BILL', label: 'Purchase Bill', labelPlural: 'Purchase Bills',
    listPath: '/purchase/bills', createEndpoint: '/purchase/bills', listEndpoint: '/purchase/bills',
    partyLabel: 'Supplier', partyType: 'SUPPLIER', side: 'purchase', hasLines: true, paymentLabel: 'Paid',
    color: 'text-blue-700 bg-blue-50',
  },
  DEBIT_NOTE: {
    type: 'DEBIT_NOTE', label: 'Debit Note', labelPlural: 'Debit Notes (Purchase Return)',
    listPath: '/purchase/debit-notes', createEndpoint: '/purchase/debit-notes', listEndpoint: '/purchase/debit-notes',
    partyLabel: 'Supplier', partyType: 'SUPPLIER', side: 'purchase', hasLines: true, paymentLabel: 'Received Back',
    color: 'text-amber-700 bg-amber-50',
  },
  PURCHASE_ORDER: {
    type: 'PURCHASE_ORDER', label: 'Purchase Order', labelPlural: 'Purchase Orders',
    listPath: '/purchase/orders', createEndpoint: '/purchase/orders', listEndpoint: '/purchase/orders',
    partyLabel: 'Supplier', partyType: 'SUPPLIER', side: 'purchase', hasLines: true, paymentLabel: 'Advance',
    convertEndpoint: (id) => `/purchase/orders/${id}/receive`, convertLabel: 'Receive → Bill', isOrder: true,
    color: 'text-indigo-600 bg-indigo-50',
  },
  PAYMENT_OUT: {
    type: 'PAYMENT_OUT', label: 'Payment Out', labelPlural: 'Payments Out',
    listPath: '/purchase/payment-out', createEndpoint: '/purchase/payments-out', listEndpoint: '/purchase/payments-out',
    partyLabel: 'Supplier', partyType: 'SUPPLIER', side: 'purchase', hasLines: false, paymentLabel: 'Paid',
    color: 'text-orange-700 bg-orange-50',
  },
  EXPENSE: {
    type: 'EXPENSE', label: 'Expense', labelPlural: 'Expenses',
    listPath: '/expenses', createEndpoint: '/expenses', listEndpoint: '/expenses',
    partyLabel: 'Party (optional)', side: 'other', hasLines: false, paymentLabel: 'Paid',
    color: 'text-rose-600 bg-rose-50',
  },
  P2P_TRANSFER: {
    type: 'P2P_TRANSFER', label: 'Party to Party Transfer', labelPlural: 'P2P Transfers',
    listPath: '/utilities', createEndpoint: '/txns', listEndpoint: '/txns?txnType=P2P_TRANSFER',
    partyLabel: 'From Party', side: 'other', hasLines: false, paymentLabel: 'Amount',
    color: 'text-gray-600 bg-gray-50',
  },
};

export const PAYMENT_TYPES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK', label: 'Bank Transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
] as const;

export const TXN_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  OPEN: { label: 'Unpaid', className: 'bg-red-100 text-red-700' },
  PARTIAL: { label: 'Partial', className: 'bg-amber-100 text-amber-700' },
  PAID: { label: 'Paid', className: 'bg-green-100 text-green-700' },
  ORDER_OPEN: { label: 'Open', className: 'bg-blue-100 text-blue-700' },
  ORDER_CLOSED: { label: 'Closed', className: 'bg-gray-100 text-gray-600' },
  CONVERTED: { label: 'Converted', className: 'bg-gray-100 text-gray-600' },
  CANCELLED: { label: 'Cancelled', className: 'bg-gray-100 text-gray-500' },
  HELD: { label: 'Held', className: 'bg-purple-100 text-purple-700' },
  REFUNDED: { label: 'Refunded', className: 'bg-orange-100 text-orange-700' },
};

export function formatMoney(v: number | string | null | undefined) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v ?? 0));
}

export function formatDate(d: string | Date | null | undefined) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
