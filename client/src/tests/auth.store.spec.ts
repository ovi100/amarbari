import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { mockAdmin, mockTenant } from './msw/handlers';

describe('auth store', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, isBootstrapping: true });
  });

  it('starts signed out and bootstrapping', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated()).toBe(false);
    expect(state.isBootstrapping).toBe(true);
  });

  it('records a session', () => {
    useAuthStore.getState().setSession(mockTenant, 'token-123');
    const state = useAuthStore.getState();
    expect(state.isAuthenticated()).toBe(true);
    expect(state.isAdmin()).toBe(false);
    expect(state.accessToken).toBe('token-123');
  });

  it('recognises an admin session', () => {
    useAuthStore.getState().setSession(mockAdmin, 'token-123');
    expect(useAuthStore.getState().isAdmin()).toBe(true);
  });

  it('clears the session on sign out', () => {
    useAuthStore.getState().setSession(mockTenant, 'token-123');
    useAuthStore.getState().clear();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.isAuthenticated()).toBe(false);
  });

  it('is not authenticated with a user but no token', () => {
    useAuthStore.setState({ user: mockTenant, accessToken: null });
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);
  });

  it('persists only the profile, never the access token', () => {
    useAuthStore.getState().setSession(mockTenant, 'super-secret-token');
    const persisted = localStorage.getItem('amarbari-auth') ?? '';
    expect(persisted).toContain(mockTenant.id);
    expect(persisted).not.toContain('super-secret-token');
  });
});

describe('toast store', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it('queues and dismisses toasts', () => {
    const id = useToastStore.getState().push({ title: 'Saved' });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('defaults to the info tone and a 5s duration', () => {
    useToastStore.getState().push({ title: 'Heads up' });
    const toast = useToastStore.getState().toasts[0]!;
    expect(toast.tone).toBe('info');
    expect(toast.duration).toBe(5000);
  });
});
