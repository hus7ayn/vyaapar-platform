export enum SystemRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  HOTEL_OWNER = 'HOTEL_OWNER',
  BRANCH_MANAGER = 'BRANCH_MANAGER',
  BILLER = 'BILLER',
  RECEPTIONIST = 'RECEPTIONIST',
  HOUSEKEEPING = 'HOUSEKEEPING',
  ACCOUNTANT = 'ACCOUNTANT',
  MAINTENANCE_STAFF = 'MAINTENANCE_STAFF',
}

export const ROLE_LABELS: Record<SystemRole, string> = {
  [SystemRole.SUPER_ADMIN]: 'Super Admin',
  [SystemRole.ADMIN]: 'Business Owner',
  [SystemRole.HOTEL_OWNER]: 'Hotel Owner',
  [SystemRole.BRANCH_MANAGER]: 'Shop Admin',
  [SystemRole.BILLER]: 'Biller',
  [SystemRole.RECEPTIONIST]: 'Receptionist',
  [SystemRole.HOUSEKEEPING]: 'Housekeeping',
  [SystemRole.ACCOUNTANT]: 'Accountant',
  [SystemRole.MAINTENANCE_STAFF]: 'Maintenance Staff',
};
