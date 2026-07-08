export enum SystemRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  HOTEL_OWNER = 'HOTEL_OWNER',
  BRANCH_MANAGER = 'BRANCH_MANAGER',
  RECEPTIONIST = 'RECEPTIONIST',
  HOUSEKEEPING = 'HOUSEKEEPING',
  ACCOUNTANT = 'ACCOUNTANT',
  MAINTENANCE_STAFF = 'MAINTENANCE_STAFF',
}

export const ROLE_LABELS: Record<SystemRole, string> = {
  [SystemRole.SUPER_ADMIN]: 'Super Admin',
  [SystemRole.HOTEL_OWNER]: 'Hotel Owner',
  [SystemRole.BRANCH_MANAGER]: 'Shop Admin',
  [SystemRole.RECEPTIONIST]: 'Receptionist',
  [SystemRole.HOUSEKEEPING]: 'Housekeeping',
  [SystemRole.ACCOUNTANT]: 'Accountant',
  [SystemRole.MAINTENANCE_STAFF]: 'Maintenance Staff',
};
