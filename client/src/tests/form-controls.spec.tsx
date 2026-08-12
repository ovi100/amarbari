import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordInput } from '@/components/ui/form-controls';
import { DateRangePicker, defaultRange } from '@/components/ui/date-range-picker';

describe('PasswordInput', () => {
  it('starts masked and reveals the value on demand', async () => {
    const user = userEvent.setup();
    render(<PasswordInput id="pw" aria-label="Password" defaultValue="hunter2" />);

    const field = document.getElementById('pw') as HTMLInputElement;
    expect(field.type).toBe('password');

    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(field.type).toBe('text');
    expect(field.value).toBe('hunter2');

    await user.click(screen.getByRole('button', { name: /hide password/i }));
    expect(field.type).toBe('password');
  });

  it('keeps the toggle out of the tab order so the form flows straight through', () => {
    render(<PasswordInput id="pw" aria-label="Password" />);
    expect(screen.getByRole('button', { name: /show password/i })).toHaveAttribute('tabindex', '-1');
  });
});

describe('DateRangePicker', () => {
  const year = new Date().getFullYear();

  function Harness() {
    const [range, setRange] = [defaultRange(), vi.fn()];
    return <DateRangePicker value={range} onChange={setRange} />;
  }

  it('exposes both date fields and marks the matching preset as active', () => {
    render(<Harness />);

    expect(document.getElementById('from')).toHaveValue(`${year}-01-01`);
    expect(document.getElementById('to')).toHaveValue(`${year}-12-31`);
    expect(screen.getByRole('button', { name: 'This year' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Last year' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('reports the selected preset range through onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangePicker value={defaultRange()} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Last year' }));
    expect(onChange).toHaveBeenCalledWith({ from: `${year - 1}-01-01`, to: `${year - 1}-12-31` });
  });

  it('summarises the span of the selected range', () => {
    render(<DateRangePicker value={{ from: `${year}-01-01`, to: `${year}-01-31` }} onChange={vi.fn()} />);
    expect(screen.getByText(/31 days/)).toBeInTheDocument();
  });
});
