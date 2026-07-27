export enum SystemRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  BRANCH_MANAGER = 'BRANCH_MANAGER',
  BILLER = 'BILLER',
  ACCOUNTANT = 'ACCOUNTANT',
}

// Labels reflect the tenant access model: the business owner (ADMIN) is the "Super Admin",
// BRANCH_MANAGER is the shop-scoped "Admin", and BILLER is the shop biller.
export const ROLE_LABELS: Record<SystemRole, string> = {
  [SystemRole.SUPER_ADMIN]: 'Platform Admin',
  [SystemRole.ADMIN]: 'Super Admin',
  [SystemRole.BRANCH_MANAGER]: 'Admin',
  [SystemRole.BILLER]: 'Biller',
  [SystemRole.ACCOUNTANT]: 'Accountant',
};
