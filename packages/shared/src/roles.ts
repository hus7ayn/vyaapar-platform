export enum SystemRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  HOTEL_OWNER = 'HOTEL_OWNER',
  BRANCH_MANAGER = 'BRANCH_MANAGER',
  BILLER = 'BILLER',
  BILLER_HOTEL = 'BILLER_HOTEL',
  RECEPTIONIST = 'RECEPTIONIST',
  HOUSEKEEPING = 'HOUSEKEEPING',
  ACCOUNTANT = 'ACCOUNTANT',
  MAINTENANCE_STAFF = 'MAINTENANCE_STAFF',
}

// Labels reflect the tenant access model: the business owner (ADMIN) is the "Super Admin",
// BRANCH_MANAGER is the shop/hotel-scoped "Admin", and there are two Biller variants.
export const ROLE_LABELS: Record<SystemRole, string> = {
  [SystemRole.SUPER_ADMIN]: 'Platform Admin',
  [SystemRole.ADMIN]: 'Super Admin',
  [SystemRole.HOTEL_OWNER]: 'Hotel Owner',
  [SystemRole.BRANCH_MANAGER]: 'Admin',
  [SystemRole.BILLER]: 'Biller (Shop)',
  [SystemRole.BILLER_HOTEL]: 'Biller (Hotel)',
  [SystemRole.RECEPTIONIST]: 'Receptionist',
  [SystemRole.HOUSEKEEPING]: 'Housekeeping',
  [SystemRole.ACCOUNTANT]: 'Accountant',
  [SystemRole.MAINTENANCE_STAFF]: 'Maintenance Staff',
};
