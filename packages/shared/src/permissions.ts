export enum Permission {
  // Business
  BUSINESS_MANAGE = 'business:manage',
  BRANCH_MANAGE = 'branch:manage',
  USER_MANAGE = 'user:manage',

  // POS
  POS_SELL = 'pos:sell',
  POS_REFUND = 'pos:refund',
  POS_PRICE_OVERRIDE = 'pos:price_override',
  POS_DISCOUNT = 'pos:discount',
  POS_HOLD_ORDER = 'pos:hold_order',

  // Inventory
  INVENTORY_VIEW = 'inventory:view',
  INVENTORY_MANAGE = 'inventory:manage',
  INVENTORY_ADJUST = 'inventory:adjust',

  // Finance
  PAYROLL_VIEW = 'payroll:view',
  PAYROLL_MANAGE = 'payroll:manage',
  EXPENSE_VIEW = 'expense:view',
  EXPENSE_MANAGE = 'expense:manage',
  EXPENSE_APPROVE = 'expense:approve',

  // Reports
  SALES_REPORTS_VIEW = 'reports:sales_view', // daily/weekly/monthly SALES reports only (Biller)
  REPORTS_VIEW = 'reports:view', // financial/revenue reports (P&L, balance sheet, cash-flow, GST, …)
  REPORTS_EXPORT = 'reports:export',

  // System
  AUDIT_VIEW = 'audit:view',
  SETTINGS_MANAGE = 'settings:manage',

  // Platform (SUPER_ADMIN only)
  PLATFORM_MANAGE = 'platform:manage',
}

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: Object.values(Permission),
  // Super Admin (business owner): full access to everything for the business.
  ADMIN: [
    Permission.BUSINESS_MANAGE,
    Permission.BRANCH_MANAGE,
    Permission.USER_MANAGE,
    Permission.POS_SELL,
    Permission.POS_REFUND,
    Permission.POS_PRICE_OVERRIDE,
    Permission.POS_DISCOUNT,
    Permission.POS_HOLD_ORDER,
    Permission.INVENTORY_VIEW,
    Permission.INVENTORY_MANAGE,
    Permission.INVENTORY_ADJUST,
    Permission.PAYROLL_VIEW,
    Permission.PAYROLL_MANAGE,
    Permission.EXPENSE_VIEW,
    Permission.EXPENSE_MANAGE,
    Permission.EXPENSE_APPROVE,
    Permission.SALES_REPORTS_VIEW,
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
    Permission.AUDIT_VIEW,
    Permission.SETTINGS_MANAGE,
  ],
  // Admin: full shop operational access within the ASSIGNED branch, EXCLUDING payroll and
  // BUSINESS_MANAGE (no BUSINESS_MANAGE => branch-scope guard confines them to one branch)
  // and platform. Everything else the owner can do, they can do for their branch.
  BRANCH_MANAGER: [
    Permission.BRANCH_MANAGE,
    Permission.USER_MANAGE,
    Permission.POS_SELL,
    Permission.POS_REFUND,
    Permission.POS_PRICE_OVERRIDE,
    Permission.POS_DISCOUNT,
    Permission.POS_HOLD_ORDER,
    Permission.INVENTORY_VIEW,
    Permission.INVENTORY_MANAGE,
    Permission.INVENTORY_ADJUST,
    Permission.EXPENSE_VIEW,
    Permission.EXPENSE_MANAGE,
    Permission.EXPENSE_APPROVE,
    Permission.SALES_REPORTS_VIEW,
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
    Permission.AUDIT_VIEW,
    Permission.SETTINGS_MANAGE,
  ],
  // Biller: POS selling + returns, plus daily/weekly/monthly SALES reports only.
  // No revenue/financial reports, no expenses, no payroll.
  BILLER: [
    Permission.POS_SELL,
    Permission.POS_REFUND,
    Permission.POS_DISCOUNT,
    Permission.POS_HOLD_ORDER,
    Permission.SALES_REPORTS_VIEW,
  ],
  ACCOUNTANT: [
    Permission.PAYROLL_VIEW,
    Permission.PAYROLL_MANAGE,
    Permission.EXPENSE_VIEW,
    Permission.EXPENSE_MANAGE,
    Permission.EXPENSE_APPROVE,
    Permission.SALES_REPORTS_VIEW,
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
  ],
};
