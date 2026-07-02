import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthUser {
  id: string;
  email: string;
  businessId: string;
  branchId?: string;
  role: string;
  permissions: string[];
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  activeShopId: string | null;
  setAuth: (data: { accessToken: string; refreshToken: string; user: AuthUser }) => void;
  setActiveShopId: (id: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      activeShopId: null,
      setAuth: (data) =>
        set({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          user: data.user,
          activeShopId: data.user.branchId || null,
        }),
      setActiveShopId: (id) => set({ activeShopId: id }),
      logout: () => set({ accessToken: null, refreshToken: null, user: null, activeShopId: null }),
    }),
    { name: 'nexus-auth' },
  ),
);
