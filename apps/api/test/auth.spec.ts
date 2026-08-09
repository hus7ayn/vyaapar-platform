import { ROLE_PERMISSIONS, SystemRole } from '@nexus/shared';
import { AuthService, SELF_RESET_ROLES, GENERIC_RESET_REPLY } from '../src/auth/auth.service';

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
    expect(ROLE_PERMISSIONS.ACCOUNTANT).toBeDefined();
  });
});

describe('who may reset their own password', () => {
  // The naming trap, pinned: the UI's "Super Admin" is the code role ADMIN (the business
  // owner). SUPER_ADMIN is the platform admin. Getting this backwards would hand self-service
  // reset to the wrong people while looking entirely correct.
  it('includes the business owner (ADMIN) and the platform admin (SUPER_ADMIN)', () => {
    expect(SELF_RESET_ROLES).toContain(SystemRole.ADMIN);
    expect(SELF_RESET_ROLES).toContain(SystemRole.SUPER_ADMIN);
  });

  it('excludes every role that has somebody above them', () => {
    expect(SELF_RESET_ROLES).not.toContain(SystemRole.BRANCH_MANAGER);
    expect(SELF_RESET_ROLES).not.toContain(SystemRole.BILLER);
    expect(SELF_RESET_ROLES).not.toContain(SystemRole.ACCOUNTANT);
  });

  it('says nothing about which accounts exist', () => {
    // The one reply forgot-password ever gives. If it ever names an address or a role, the
    // endpoint becomes a way to enumerate accounts.
    expect(GENERIC_RESET_REPLY).not.toMatch(/@/);
    expect(GENERIC_RESET_REPLY.toLowerCase()).not.toContain('not found');
  });
});

describe('reset code generation', () => {
  it('always produces exactly six digits', () => {
    // Math.random()-style formatting silently drops leading zeros, which turns into a code the
    // user cannot type back in.
    for (let i = 0; i < 2000; i++) {
      expect(AuthService.generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('can produce a code starting with zero', () => {
    const codes = Array.from({ length: 4000 }, () => AuthService.generateOtpCode());
    expect(codes.some((c) => c.startsWith('0'))).toBe(true);
  });

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 500 }, () => AuthService.generateOtpCode()));
    expect(codes.size).toBeGreaterThan(450);
  });
});

describe('verification tokens', () => {
  it('never stores the raw token as its own hash', () => {
    const { token, tokenHash } = AuthService.generateVerificationToken();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is long enough that guessing is hopeless', () => {
    // The DTO refuses anything under 32 characters; the generator must clear that comfortably.
    expect(AuthService.generateVerificationToken().token.length).toBeGreaterThanOrEqual(64);
  });

  it('hashes deterministically for one input and differently across inputs', () => {
    expect(AuthService.hashToken('abc')).toBe(AuthService.hashToken('abc'));
    expect(AuthService.hashToken('abc')).not.toBe(AuthService.hashToken('abd'));
  });
});
