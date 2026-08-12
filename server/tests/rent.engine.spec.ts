import { describe, expect, it } from 'vitest';
import { PaymentStatus } from '@prisma/client';
import {
  calculateTenancyDuration,
  computeDeferral,
  money,
} from '../src/services/rent.service';
import { recognizedRent } from '../src/services/analytics.service';

describe('rent & advance math engine (SRS 8.1)', () => {
  it('deducts the full bill when the advance covers it', () => {
    const result = computeDeferral({
      outstanding: 600,
      advanceDeposit: 1000,
      accumulatedDue: 0,
      alreadyDeducted: 0,
      mode: 'DEDUCT_FROM_ADVANCE',
    });

    expect(result.advanceDeducted).toBe(600);
    expect(result.newAdvanceDeposit).toBe(400);
    expect(result.rolledOver).toBe(0);
    expect(result.newAccumulatedDue).toBe(0);
    expect(result.paymentStatus).toBe(PaymentStatus.DEDUCTED_FROM_ADVANCE);
  });

  // QA matrix 7.2 — the headline scenario.
  it('splits a 600 bill against a 500 advance: 500 deducted, 100 carried forward', () => {
    const result = computeDeferral({
      outstanding: 600,
      advanceDeposit: 500,
      accumulatedDue: 0,
      alreadyDeducted: 0,
      mode: 'DEDUCT_FROM_ADVANCE',
    });

    expect(result.advanceDeducted).toBe(500);
    expect(result.newAdvanceDeposit).toBe(0);
    expect(result.rolledOver).toBe(100);
    expect(result.newAccumulatedDue).toBe(100);
    expect(result.paymentStatus).toBe(PaymentStatus.PARTIAL);
  });

  it('rolls the whole balance over and leaves the advance untouched', () => {
    const result = computeDeferral({
      outstanding: 750,
      advanceDeposit: 5000,
      accumulatedDue: 250,
      alreadyDeducted: 0,
      mode: 'ROLLOVER',
    });

    expect(result.newAdvanceDeposit).toBe(5000);
    expect(result.advanceDeducted).toBe(0);
    expect(result.rolledOver).toBe(750);
    expect(result.newAccumulatedDue).toBe(1000);
    expect(result.paymentStatus).toBe(PaymentStatus.DUE);
  });

  it('falls back to a pure rollover when the advance is empty', () => {
    const result = computeDeferral({
      outstanding: 400,
      advanceDeposit: 0,
      accumulatedDue: 0,
      alreadyDeducted: 0,
      mode: 'DEDUCT_FROM_ADVANCE',
    });

    expect(result.advanceDeducted).toBe(0);
    expect(result.rolledOver).toBe(400);
    expect(result.paymentStatus).toBe(PaymentStatus.DUE);
  });

  it('accumulates onto a prior partial deduction without double counting', () => {
    const result = computeDeferral({
      outstanding: 200, // 500 total, 300 already taken from advance
      advanceDeposit: 120,
      accumulatedDue: 0,
      alreadyDeducted: 300,
      mode: 'DEDUCT_FROM_ADVANCE',
    });

    expect(result.advanceDeducted).toBe(420);
    expect(result.newAdvanceDeposit).toBe(0);
    expect(result.rolledOver).toBe(80);
  });

  it('keeps repeated settlements free of float drift', () => {
    let advance = 1000.1;
    for (let i = 0; i < 10; i++) {
      const step = computeDeferral({
        outstanding: 33.33,
        advanceDeposit: advance,
        accumulatedDue: 0,
        alreadyDeducted: 0,
        mode: 'DEDUCT_FROM_ADVANCE',
      });
      advance = step.newAdvanceDeposit;
    }
    expect(advance).toBe(666.8);
  });

  it('never produces a negative outstanding', () => {
    const result = computeDeferral({
      outstanding: -50,
      advanceDeposit: 100,
      accumulatedDue: 0,
      alreadyDeducted: 0,
      mode: 'DEDUCT_FROM_ADVANCE',
    });
    expect(result.advanceDeducted).toBe(0);
    expect(result.newAdvanceDeposit).toBe(100);
  });

  it('rounds to two decimals', () => {
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(1.005)).toBe(1.01);
  });
});

describe('tenancy duration counter (SRS 3.1.3)', () => {
  it('formats years, months and days', () => {
    const duration = calculateTenancyDuration(
      new Date('2024-01-05T00:00:00Z'),
      new Date('2025-04-17T00:00:00Z')
    );
    expect(duration.years).toBe(1);
    expect(duration.months).toBe(3);
    expect(duration.days).toBe(12);
    expect(duration.label).toBe('1 Year, 3 Months, 12 Days');
  });

  it('borrows days from the previous month correctly', () => {
    const duration = calculateTenancyDuration(
      new Date('2024-01-31T00:00:00Z'),
      new Date('2024-03-01T00:00:00Z')
    );
    expect(duration.years).toBe(0);
    expect(duration.months).toBe(1);
    expect(duration.days).toBe(1);
  });

  it('singularises a one-day tenancy', () => {
    const duration = calculateTenancyDuration(
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-02T00:00:00Z')
    );
    expect(duration.label).toBe('1 Day');
  });

  it('reports zero for a future start date', () => {
    const duration = calculateTenancyDuration(
      new Date('2030-01-01T00:00:00Z'),
      new Date('2026-01-01T00:00:00Z')
    );
    expect(duration.totalDays).toBe(0);
    expect(duration.label).toBe('0 Days');
  });
});

describe('revenue recognition (SRS 3.2.3)', () => {
  it('counts only base flat rent, never utility pass-through', () => {
    expect(recognizedRent({ flatRent: 18000, paidAmount: 22000, advanceDeducted: 0 })).toBe(18000);
  });

  it('recognises a partial collection up to the rent line', () => {
    expect(recognizedRent({ flatRent: 18000, paidAmount: 5000, advanceDeducted: 2000 })).toBe(7000);
  });

  it('recognises nothing on an unpaid invoice', () => {
    expect(recognizedRent({ flatRent: 18000, paidAmount: 0, advanceDeducted: 0 })).toBe(0);
  });
});
