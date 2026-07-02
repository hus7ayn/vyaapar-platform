'use client';

import { Permission } from '@nexus/shared';
import { usePermissions } from '@/hooks/use-permissions';

export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission | Permission[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { has } = usePermissions();
  if (!has(permission)) return <>{fallback}</>;
  return <>{children}</>;
}
