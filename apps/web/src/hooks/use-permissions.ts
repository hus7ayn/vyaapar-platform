import { Permission } from '@nexus/shared';
import { useAuthStore } from '@/stores/auth-store';

export function usePermissions() {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);

  const has = (required: Permission | Permission[]) => {
    const list = Array.isArray(required) ? required : [required];
    return list.some((p) => permissions.includes(p));
  };

  const hasAll = (required: Permission[]) => required.every((p) => permissions.includes(p));

  return { permissions, has, hasAll };
}
