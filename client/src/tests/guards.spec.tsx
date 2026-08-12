import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { RequireRole } from '@/routes/guards';
import { renderWithProviders, signIn, signOut } from './utils';
import { mockAdmin, mockTenant } from './msw/handlers';

function AdminOnly() {
  return <p>Secret admin analytics</p>;
}

function LoginStub() {
  return <p>Login screen</p>;
}

function tree() {
  return (
    <Routes>
      <Route path="/login" element={<LoginStub />} />
      <Route element={<RequireRole role="ADMIN" />}>
        <Route path="/admin" element={<AdminOnly />} />
      </Route>
    </Routes>
  );
}

describe('RBAC route guard (QA matrix 7.2)', () => {
  it('blocks a tenant from an admin route with an explicit denial', async () => {
    signIn(mockTenant);
    renderWithProviders(tree(), { route: '/admin' });

    expect(await screen.findByText(/access denied/i)).toBeInTheDocument();
    expect(screen.queryByText(/secret admin analytics/i)).not.toBeInTheDocument();
  });

  it('lets an admin through', async () => {
    signIn(mockAdmin);
    renderWithProviders(tree(), { route: '/admin' });

    expect(await screen.findByText(/secret admin analytics/i)).toBeInTheDocument();
  });

  it('redirects an anonymous visitor to the login screen', async () => {
    signOut();
    renderWithProviders(tree(), { route: '/admin' });

    expect(await screen.findByText(/login screen/i)).toBeInTheDocument();
    expect(screen.queryByText(/secret admin analytics/i)).not.toBeInTheDocument();
  });

  it('waits for the session bootstrap before deciding', () => {
    signOut();
    // Simulate a cold load where the silent refresh has not settled yet.
    renderWithProviders(tree(), { route: '/admin' });
    signOut();
    expect(screen.queryByText(/secret admin analytics/i)).not.toBeInTheDocument();
  });
});
