import { ROLE_PERMISSIONS } from '@nexus/shared';

describe('RBAC', () => {
  it('admin has POS sell permission', () => {
    expect(ROLE_PERMISSIONS.ADMIN).toContain('pos:sell');
  });

  it('biller cannot manage payroll', () => {
    expect(ROLE_PERMISSIONS.BILLER).not.toContain('payroll:manage');
  });
});

describe('Auth constants', () => {
  it('has all role permission maps', () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.length).toBeGreaterThan(0);
    expect(ROLE_PERMISSIONS.HR_MANAGER).toBeDefined();
  });
});
