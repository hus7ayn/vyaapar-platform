import { create } from 'zustand';

interface UiState {
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;
  toggleMobileNav: () => void;
}

// Coordinates the mobile navigation drawer (opened by the top-bar hamburger,
// rendered by the Sidebar). Desktop (lg+) shows the sidebar statically and
// ignores this.
export const useUiStore = create<UiState>((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
}));
