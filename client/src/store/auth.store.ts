import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  /** True until the initial silent refresh settles, so guards don't bounce early. */
  isBootstrapping: boolean;

  setSession: (user: User, accessToken: string) => void;
  setUser: (user: User) => void;
  setAccessToken: (accessToken: string | null) => void;
  setBootstrapped: () => void;
  clear: () => void;

  isAuthenticated: () => boolean;
  isAdmin: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isBootstrapping: true,

      setSession: (user, accessToken) => set({ user, accessToken }),
      setUser: (user) => set({ user }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setBootstrapped: () => set({ isBootstrapping: false }),
      clear: () => set({ user: null, accessToken: null }),

      isAuthenticated: () => Boolean(get().accessToken && get().user),
      isAdmin: () => get().user?.role === 'ADMIN',
    }),
    {
      name: 'amarbari-auth',
      // The access token is short-lived and the refresh token lives in an
      // HTTP-only cookie, so only the user profile is worth persisting.
      partialize: (state) => ({ user: state.user }),
    }
  )
);
