import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TenantMetersPage from '@/pages/tenant/MetersPage';
import { DEFAULT_PER_UNIT, buildReadingSchema, meterSchema } from '@/lib/schemas';
import { renderWithProviders, signIn } from './utils';
import { mockTenant } from './msw/handlers';

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({ socket: null, status: 'idle', isConnected: false }),
  useSocketEvent: () => {},
  getSocket: () => null,
}));

describe('meter form rules (SRS 3.2.9)', () => {
  const valid = {
    meterName: 'Ground floor east',
    meterNumber: 'MTR-0012',
    previousReading: 900,
    currentReading: 1000,
    perUnitRate: '',
    unitId: '',
  };

  it('accepts a meter with a blank rate — that means "category default"', () => {
    const parsed = meterSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(DEFAULT_PER_UNIT).toEqual({ FLAT: 10, SHOP: 15 });
  });

  it('rejects a current reading below the previous one', () => {
    const parsed = meterSchema.safeParse({ ...valid, currentReading: 800 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path[0] === 'currentReading');
      expect(issue?.message).toMatch(/cannot be below the previous reading/i);
    }
  });

  it('rejects a blank reading rather than treating it as a stated zero (§8.4)', () => {
    const parsed = meterSchema.safeParse({ ...valid, currentReading: '' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/required/i);
    }
  });

  it('accepts a stated zero', () => {
    expect(
      meterSchema.safeParse({ ...valid, previousReading: 0, currentReading: 0 }).success
    ).toBe(true);
  });

  it('will not allocate a unit without saying which category it is', () => {
    const parsed = meterSchema.safeParse({ ...valid, unitId: 'flat-1' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.find((i) => i.path[0] === 'category')).toBeTruthy();
    }
  });

  it('rejects a zero or negative per-unit rate', () => {
    expect(meterSchema.safeParse({ ...valid, perUnitRate: '0' }).success).toBe(false);
    expect(meterSchema.safeParse({ ...valid, perUnitRate: '-5' }).success).toBe(false);
    expect(meterSchema.safeParse({ ...valid, perUnitRate: '12.5' }).success).toBe(true);
  });
});

describe('reading floor', () => {
  it('refuses a reading below the meter’s previous value, naming it', () => {
    const parsed = buildReadingSchema(1000).safeParse({ currentReading: 999 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toContain('1000');
  });

  it('accepts an unchanged dial — a month with no consumption', () => {
    expect(buildReadingSchema(1000).safeParse({ currentReading: 1000 }).success).toBe(true);
  });
});

describe('resident meter page', () => {
  it('shows the meter, its rate, and that no reading has been filed', async () => {
    signIn(mockTenant);
    renderWithProviders(<TenantMetersPage />);

    expect(await screen.findByText('MTR-0012')).toBeInTheDocument();
    expect(screen.getByText('Reading due')).toBeInTheDocument();
    expect(screen.getByText('Ground floor east')).toBeInTheDocument();
  });

  it('previews the charge as the reading is typed, then files it', async () => {
    signIn(mockTenant);
    const user = userEvent.setup();
    renderWithProviders(<TenantMetersPage />);

    await user.click(await screen.findByRole('button', { name: /reading/i }));

    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText(/meter reading/i);
    await user.clear(input);
    await user.type(input, '1120');

    // 120 units over the last reading of 1000, at 10 per unit.
    await waitFor(() =>
      expect(within(dialog).getByText(/120 units/)).toBeInTheDocument()
    );
    expect(within(dialog).getByText('BDT 1,200.00')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /save reading/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('will not let a resident file a reading below the dial', async () => {
    signIn(mockTenant);
    const user = userEvent.setup();
    renderWithProviders(<TenantMetersPage />);

    await user.click(await screen.findByRole('button', { name: /reading/i }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText(/meter reading/i);
    await user.clear(input);
    await user.type(input, '980');
    await user.click(within(dialog).getByRole('button', { name: /save reading/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/1000/);
  });
});
