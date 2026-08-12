import { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RenderOptions, render } from '@testing-library/react';
import { useAuthStore } from '@/store/auth.store';
import type { User } from '@/types';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** Puts a signed-in session in place without going through the login screen. */
export function signIn(user: User, accessToken = 'test-access-token') {
  useAuthStore.setState({ user, accessToken, isBootstrapping: false });
}

export function signOut() {
  useAuthStore.setState({ user: null, accessToken: null, isBootstrapping: false });
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', ...options }: RenderOptions & { route?: string } = {}
) {
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}
