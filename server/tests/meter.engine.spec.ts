import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PER_UNIT,
  categoryOf,
  computeConsumption,
  effectiveRate,
} from '../src/services/meter.service';
import { diffOf, sanitiseForLog } from '../src/services/activity.service';
import { describeRoute } from '../src/middlewares/audit';

/**
 * The metering maths and the audit-log helpers, with no database in play — so
 * these assert on every machine, not only where Postgres is running.
 */

describe('electricity charge (SRS 8.11)', () => {
  it('bills (current − previous) × per-unit', () => {
    expect(computeConsumption(1200, 1345, 10)).toEqual({ unitsConsumed: 145, amount: 1450 });
  });

  it('charges nothing when the dial has not moved', () => {
    expect(computeConsumption(1200, 1200, 15)).toEqual({ unitsConsumed: 0, amount: 0 });
  });

  it('rounds to two decimals rather than accumulating float error', () => {
    // 0.1 + 0.2 territory: 10.3 × 3 is 30.900000000000002 unrounded.
    expect(computeConsumption(0, 10.3, 3).amount).toBe(30.9);
  });
});

describe('per-unit tariff', () => {
  it('defaults to 10 for a flat and 15 for a shop', () => {
    expect(DEFAULT_PER_UNIT).toEqual({ FLAT: 10, SHOP: 15 });
    expect(effectiveRate({ perUnitRate: null, flatId: 'f1', shopId: null })).toBe(10);
    expect(effectiveRate({ perUnitRate: null, flatId: null, shopId: 's1' })).toBe(15);
  });

  it('lets a meter override the default', () => {
    expect(effectiveRate({ perUnitRate: 8.5, flatId: 'f1', shopId: null })).toBe(8.5);
    expect(effectiveRate({ perUnitRate: 22, flatId: null, shopId: 's1' })).toBe(22);
  });

  it('follows the flat default while unassigned, and re-reads on allocation', () => {
    const meter = { perUnitRate: null, flatId: null, shopId: null };
    expect(effectiveRate(meter)).toBe(10);
    // The rate is not frozen onto the row, so moving it to a shop re-rates it.
    expect(effectiveRate({ ...meter, shopId: 's1' })).toBe(15);
  });

  it('reports which category a meter belongs to', () => {
    expect(categoryOf({ flatId: 'f1', shopId: null })).toBe('FLAT');
    expect(categoryOf({ flatId: null, shopId: 's1' })).toBe('SHOP');
    expect(categoryOf({ flatId: null, shopId: null })).toBeNull();
  });
});

describe('activity log sanitisation (SRS 3.2.10)', () => {
  it('redacts anything that looks like a secret', () => {
    const clean = sanitiseForLog({
      fullName: 'Rahim',
      password: 'Passw0rd!23',
      passwordHash: '$2a$12$abc',
      confirmPassword: 'Passw0rd!23',
      code: '123456',
      nested: { token: 'jwt.value', keep: 'visible' },
    }) as Record<string, unknown>;

    expect(clean.fullName).toBe('Rahim');
    expect(clean.password).toBe('[redacted]');
    expect(clean.passwordHash).toBe('[redacted]');
    expect(clean.confirmPassword).toBe('[redacted]');
    expect(clean.code).toBe('[redacted]');
    expect((clean.nested as Record<string, unknown>).token).toBe('[redacted]');
    expect((clean.nested as Record<string, unknown>).keep).toBe('visible');
  });

  it('clamps long strings so one entry cannot dominate the table', () => {
    const clean = sanitiseForLog({ note: 'x'.repeat(2000) }) as Record<string, string>;
    expect(clean.note.length).toBeLessThan(600);
    expect(clean.note).toContain('2000 chars');
  });

  it('keeps only the fields that actually changed', () => {
    const { before, after } = diffOf(
      { currentReading: 100, perUnitRate: 10, meterName: 'East' },
      { currentReading: 180, perUnitRate: 10, meterName: 'East' }
    );
    expect(before).toEqual({ currentReading: 100 });
    expect(after).toEqual({ currentReading: 180 });
  });
});

describe('audit route description', () => {
  const id = '11111111-2222-3333-4444-555555555555';

  it('names the model a path acts on, and the record when there is one', () => {
    expect(describeRoute(`/admin/meters/${id}/readings`)).toEqual({
      entity: 'Meter',
      entityId: id,
    });
    expect(describeRoute('/admin/flats')).toEqual({ entity: 'Flat', entityId: null });
    expect(describeRoute(`/admin/shops/${id}/tenancy`)).toEqual({ entity: 'Shop', entityId: id });
    expect(describeRoute('/auth/register')).toEqual({ entity: 'User', entityId: null });
  });

  it('falls back rather than guessing at an unknown path', () => {
    expect(describeRoute('/something/else')).toEqual({ entity: 'Api', entityId: null });
  });
});
