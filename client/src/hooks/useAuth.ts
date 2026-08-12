import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/services/endpoints';
import { ensureFreshToken } from '@/services/api';

/**
 * Restores the session on a cold load: the access token lives in memory only,
 * so a page refresh silently exchanges the HTTP-only refresh cookie for a new
 * one before any guard runs.
 */
export function useSessionBootstrap() {
  const { accessToken, isBootstrapping, setBootstrapped, setUser } = useAuthStore();

  useEffect(() => {
    if (!isBootstrapping) return;
    let cancelled = false;

    (async () => {
      if (!accessToken) {
        const token = await ensureFreshToken();
        if (token && !cancelled) {
          try {
            setUser(await authApi.me());
          } catch {
            /* refresh succeeded but profile fetch failed — guards will redirect */
          }
        }
      }
      if (!cancelled) setBootstrapped();
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isBootstrapping };
}

export function useAuth() {
  const { user, accessToken, setSession, clear } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const login = useCallback(
    async (phone: string, password: string) => {
      const session = await authApi.login(phone, password);
      setSession(session.user, session.accessToken);
      queryClient.clear();
      return session.user;
    },
    [setSession, queryClient]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* revoking server-side is best effort — always clear locally */
    }
    clear();
    queryClient.clear();
    navigate('/login', { replace: true });
  }, [clear, queryClient, navigate]);

  return {
    user,
    accessToken,
    isAuthenticated: Boolean(user && accessToken),
    isAdmin: user?.role === 'ADMIN',
    login,
    logout,
  };
}
