import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

interface UiState {
  theme: Theme;
  sidebarOpen: boolean;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

function apply(theme: Theme) {
  if (typeof document === 'undefined') return;
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      sidebarOpen: false,
      setTheme: (theme) => {
        apply(theme);
        set({ theme });
      },
      toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    {
      name: 'amarbari-ui',
      partialize: (state) => ({ theme: state.theme }),
      onRehydrateStorage: () => (state) => apply(state?.theme ?? 'system'),
    }
  )
);

export function initTheme() {
  apply(useUiStore.getState().theme);
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => apply(useUiStore.getState().theme));
}
