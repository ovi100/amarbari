import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '@/pages/auth/LoginPage';
import { renderWithProviders, signOut } from './utils';
import { useAuthStore } from '@/store/auth.store';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

describe('LoginPage', () => {
  it('surfaces client-side validation before any request', async () => {
    signOut();
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/phone number is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
  });

  it('signs a tenant in and stores the session', async () => {
    signOut();
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/phone number/i), '01711111111');
    await user.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'Str0ng!Passw0rd');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe('test-access-token');
    });
    expect(useAuthStore.getState().user?.role).toBe('TENANT');
    expect(navigate).toHaveBeenCalledWith('/app', { replace: true });
  });

  it('routes an admin to the admin dashboard', async () => {
    signOut();
    navigate.mockClear();
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/phone number/i), '01700000000');
    await user.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'Str0ng!Passw0rd');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin', { replace: true }));
  });

  it('shows the server error on a bad password and keeps the user signed out', async () => {
    signOut();
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/phone number/i), '01711111111');
    await user.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'WrongPassword1');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/i);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('toggles password visibility', async () => {
    signOut();
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    const field = screen.getByLabelText(/password/i, { selector: 'input' });
    expect(field).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(field).toHaveAttribute('type', 'text');
  });
});
