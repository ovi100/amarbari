import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/auth.store';
import type { ApiEnvelope, ApiErrorBody } from '@/types';

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

export const api = axios.create({
  baseURL: API_BASE_URL,
  // Required so the HTTP-only refresh cookie travels with /auth requests.
  withCredentials: true,
  timeout: 30_000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Pulls a human-readable message out of the standard error envelope. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;
    if (body?.error?.message) {
      const details = body.error.details;
      if (Array.isArray(details) && details.length > 0) {
        const first = details[0] as { path?: string; message?: string };
        if (first?.message) return first.message;
      }
      return body.error.message;
    }
    if (error.code === 'ECONNABORTED') return 'The request timed out — please try again';
    if (!error.response) return 'Cannot reach the server. Is the API running?';
  }
  return error instanceof Error ? error.message : fallback;
}

export function errorCode(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as ApiErrorBody | undefined)?.error?.code ?? null;
  }
  return null;
}

// --- Silent access-token refresh -------------------------------------------

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await axios.post<ApiEnvelope<{ accessToken: string; user: never }>>(
      `${API_BASE_URL}/auth/refresh`,
      {},
      { withCredentials: true }
    );
    const token = data.data.accessToken;
    useAuthStore.getState().setAccessToken(token);
    if (data.data.user) useAuthStore.getState().setUser(data.data.user);
    return token;
  } catch {
    useAuthStore.getState().clear();
    return null;
  }
}

/** Coalesces concurrent 401s into a single refresh round-trip. */
export function ensureFreshToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = refreshAccessToken().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    const url = original?.url ?? '';

    const isAuthEndpoint =
      url.includes('/auth/login') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/register');

    if (status === 401 && original && !original._retried && !isAuthEndpoint) {
      original._retried = true;
      const token = await ensureFreshToken();
      if (token) {
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return api.request(original);
      }
      // Refresh failed — the session is genuinely over.
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login?expired=1');
      }
    }

    return Promise.reject(error);
  }
);

/** Unwraps `{ success, data }` so callers work with payloads directly. */
export async function unwrap<T>(promise: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  const response = await promise;
  return response.data.data;
}

export default api;
