import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminDashboard from '@/pages/admin/AdminDashboard';
import { mockAdmin } from './msw/handlers';
import { renderWithProviders, signIn } from './utils';

const year = new Date().getFullYear();

describe('Admin overview', () => {
  it('renders the date range filter with both fields and the year presets', async () => {
    signIn(mockAdmin);
    renderWithProviders(<AdminDashboard />);

    await screen.findAllByText(/revenue \(base rent\)/i);

    // The filter is on the page, not hidden behind a popover.
    expect(document.getElementById('from')).toHaveValue(`${year}-01-01`);
    expect(document.getElementById('to')).toHaveValue(`${year}-12-31`);

    // Presets are real buttons, and the active one is visibly selected.
    const thisYear = screen.getByRole('button', { name: 'This year' });
    expect(thisYear).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Last year' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'This month' })).toBeInTheDocument();
  });

  it('moves both date fields when a preset is chosen', async () => {
    const user = userEvent.setup();
    signIn(mockAdmin);
    renderWithProviders(<AdminDashboard />);

    await screen.findAllByText(/revenue \(base rent\)/i);
    await user.click(screen.getByRole('button', { name: 'Last year' }));

    await waitFor(() => expect(document.getElementById('from')).toHaveValue(`${year - 1}-01-01`));
    expect(document.getElementById('to')).toHaveValue(`${year - 1}-12-31`);
    expect(screen.getByRole('button', { name: 'Last year' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('gives both chart cards the same always-visible view switch', async () => {
    signIn(mockAdmin);
    renderWithProviders(<AdminDashboard />);

    await screen.findByText(/revenue vs expenses/i);

    // One switch per card, each offering both options at once rather than a
    // single button that relabels itself.
    const switches = screen.getAllByRole('group', { name: /view$/i });
    expect(switches).toHaveLength(2);

    for (const control of switches) {
      expect(within(control).getByRole('button', { name: /chart view/i })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(within(control).getByRole('button', { name: /table view/i })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    }
  });

  it('switches the revenue card to a table and back', async () => {
    const user = userEvent.setup();
    signIn(mockAdmin);
    renderWithProviders(<AdminDashboard />);

    await screen.findByText(/revenue vs expenses/i);

    const revenueSwitch = screen.getByRole('group', { name: /revenue vs expenses view/i });
    await user.click(within(revenueSwitch).getByRole('button', { name: /table view/i }));

    expect(screen.getByRole('columnheader', { name: /net profit/i })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Jan 2026' })).toBeInTheDocument();

    await user.click(within(revenueSwitch).getByRole('button', { name: /chart view/i }));
    expect(screen.queryByRole('columnheader', { name: /net profit/i })).not.toBeInTheDocument();
  });
});
