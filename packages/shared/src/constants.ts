export const APP_NAME = 'MSW Global';

export const ORDER_STATUS = {
  DRAFT: 'DRAFT',
  HELD: 'HELD',
  COMPLETED: 'COMPLETED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;

export const PAYMENT_METHOD = {
  CASH: 'CASH',
  CARD: 'CARD',
  UPI: 'UPI',
  WALLET: 'WALLET',
  SPLIT: 'SPLIT',
} as const;

