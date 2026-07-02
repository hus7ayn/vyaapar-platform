export const TXN_TYPES = [
  'SALE_INVOICE',
  'CREDIT_NOTE',
  'SALE_ORDER',
  'DELIVERY_CHALLAN',
  'ESTIMATE',
  'PAYMENT_IN',
  'PURCHASE_BILL',
  'DEBIT_NOTE',
  'PURCHASE_ORDER',
  'PAYMENT_OUT',
  'EXPENSE',
  'P2P_TRANSFER',
] as const;

export type TxnType = (typeof TXN_TYPES)[number];

export const DEFAULT_PREFIXES: Record<TxnType, string> = {
  SALE_INVOICE: 'INV',
  CREDIT_NOTE: 'CN',
  SALE_ORDER: 'SO',
  DELIVERY_CHALLAN: 'DC',
  ESTIMATE: 'EST',
  PAYMENT_IN: 'PI',
  PURCHASE_BILL: 'PB',
  DEBIT_NOTE: 'DN',
  PURCHASE_ORDER: 'PO',
  PAYMENT_OUT: 'PMO',
  EXPENSE: 'EXP',
  P2P_TRANSFER: 'P2P',
};

/** Stock effect of each txn type from the business's perspective. */
export const STOCK_EFFECT: Partial<Record<TxnType, 1 | -1>> = {
  SALE_INVOICE: -1,
  CREDIT_NOTE: 1, // sale return: goods come back
  PURCHASE_BILL: 1,
  DEBIT_NOTE: -1, // purchase return: goods go out
};

export const STOCK_MOVEMENT_TYPE: Partial<Record<TxnType, string>> = {
  SALE_INVOICE: 'SALE',
  CREDIT_NOTE: 'SALE_RETURN',
  PURCHASE_BILL: 'PURCHASE',
  DEBIT_NOTE: 'PURCHASE_RETURN',
};

/**
 * Party balance effect per unit of unpaid amount.
 * Convention: positive balance = receivable (party owes us).
 *  - SALE_INVOICE: +balance (they owe us the unpaid part)
 *  - CREDIT_NOTE: -total (we owe them back / reduce receivable)
 *  - PURCHASE_BILL: -balance (we owe supplier)
 *  - DEBIT_NOTE: +total (supplier owes us back / reduce payable)
 *  - PAYMENT_IN: -amount (receivable reduced)
 *  - PAYMENT_OUT: +amount (payable reduced)
 */
export const ORDER_TYPES: TxnType[] = ['SALE_ORDER', 'PURCHASE_ORDER', 'ESTIMATE', 'DELIVERY_CHALLAN'];
export const PAYMENT_TYPES: TxnType[] = ['PAYMENT_IN', 'PAYMENT_OUT'];

export const LEDGER_ENTRY_TYPE: Partial<Record<TxnType, string>> = {
  SALE_INVOICE: 'SALE',
  CREDIT_NOTE: 'CREDIT_NOTE',
  PURCHASE_BILL: 'PURCHASE',
  DEBIT_NOTE: 'DEBIT_NOTE',
  PAYMENT_IN: 'PAYMENT_IN',
  PAYMENT_OUT: 'PAYMENT_OUT',
  P2P_TRANSFER: 'P2P',
};

export const TXN_LABELS: Record<TxnType, string> = {
  SALE_INVOICE: 'Sale Invoice',
  CREDIT_NOTE: 'Credit Note',
  SALE_ORDER: 'Sale Order',
  DELIVERY_CHALLAN: 'Delivery Challan',
  ESTIMATE: 'Estimate',
  PAYMENT_IN: 'Payment In',
  PURCHASE_BILL: 'Purchase Bill',
  DEBIT_NOTE: 'Debit Note',
  PURCHASE_ORDER: 'Purchase Order',
  PAYMENT_OUT: 'Payment Out',
  EXPENSE: 'Expense',
  P2P_TRANSFER: 'Party to Party Transfer',
};
