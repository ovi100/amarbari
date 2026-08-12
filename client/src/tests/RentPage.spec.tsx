import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RentPage from '@/pages/tenant/RentPage';
import { renderWithProviders, signIn } from './utils';
import { mockTenant } from './msw/handlers';

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({ socket: null, status: 'idle', isConnected: false }),
  useSocketEvent: () => {},
  getSocket: () => null,
}));

describe('RentPage — deferral flow (QA matrix 7.2)', () => {
  it('shows the tenancy duration counter and balances', async () => {
    signIn(mockTenant);
    renderWithProviders(<RentPage />);

    expect(await screen.findByText(/1 Year, 3 Months, 12 Days/)).toBeInTheDocument();
    expect(screen.getByText('BDT 500.00')).toBeInTheDocument(); // advance deposit
  });

  it('previews a 500-advance / 600-bill split before confirming', async () => {
    signIn(mockTenant);
    const user = userEvent.setup();
    renderWithProviders(<RentPage />);

    await user.click(await screen.findByRole('button', { name: /defer this month/i }));

    const dialog = await screen.findByRole('dialog');
    // Default mode deducts from the advance.
    expect(within(dialog).getByText('Deducted from advance: BDT 500.00')).toBeInTheDocument();
    expect(within(dialog).getByText('Carried to next month: BDT 100.00')).toBeInTheDocument();
    expect(within(dialog).getByText('Advance remaining: BDT 0.00')).toBeInTheDocument();
  });

  it('previews a pure rollover leaving the advance untouched', async () => {
    signIn(mockTenant);
    const user = userEvent.setup();
    renderWithProviders(<RentPage />);

    await user.click(await screen.findByRole('button', { name: /defer this month/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText(/roll the whole balance/i));

    expect(within(dialog).getByText('Deducted from advance: BDT 0.00')).toBeInTheDocument();
    expect(within(dialog).getByText('Carried to next month: BDT 600.00')).toBeInTheDocument();
    expect(within(dialog).getByText('Advance remaining: BDT 500.00')).toBeInTheDocument();
  });

  it('submits the deferral and closes the dialog', async () => {
    signIn(mockTenant);
    const user = userEvent.setup();
    renderWithProviders(<RentPage />);

    await user.click(await screen.findByRole('button', { name: /defer this month/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /confirm deferral/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
