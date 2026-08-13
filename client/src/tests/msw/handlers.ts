import { HttpResponse, http } from 'msw';
import type { MeterView, RentSummary, User } from '@/types';

const API = 'http://localhost:4000/api/v1';

export const mockTenant: User = {
  id: 'tenant-1',
  fullName: 'Ayesha Siddika',
  phone: '+8801711111111',
  role: 'USER',
  isPhoneVerified: true,
  isApproved: true,
  dob: '1990-02-18T00:00:00.000Z',
  familyMembers: 3,
  identityType: 'NID',
  identityNumber: '1990000111234',
  village: 'Mirpur DOHS Road 5',
  postOffice: 'Mirpur',
  district: 'Dhaka',
  policeStation: 'Pallabi',
  division: 'Dhaka',
  createdAt: '2025-01-05T00:00:00.000Z',
};

export const mockAdmin: User = { ...mockTenant, id: 'admin-1', fullName: 'Rahman Admin', role: 'ADMIN' };

export const mockRentSummary: RentSummary = {
  tenancy: {
    id: 'tenancy-1',
    userId: 'tenant-1',
    flatId: 'flat-1',
    shopId: null,
    startDate: '2025-01-05T00:00:00.000Z',
    endDate: null,
    advanceDeposit: 500,
    accumulatedDue: 0,
    isActive: true,
    duration: { years: 1, months: 3, days: 12, totalDays: 467, label: '1 Year, 3 Months, 12 Days' },
  },
  unit: {
    category: 'FLAT',
    number: 'A-101',
    label: 'A-101',
    location: 'Main Building, floor 1',
  },
  flat: {
    id: 'flat-1',
    flatNumber: 'A-101',
    floor: 1,
    building: 'Main Building',
    isOccupied: true,
    baseRent: 600,
    createdAt: '2024-12-01T00:00:00.000Z',
    updatedAt: '2024-12-01T00:00:00.000Z',
  },
  currentInvoice: {
    id: 'invoice-1',
    flatId: 'flat-1',
    shopId: null,
    month: 3,
    year: 2026,
    flatRent: 600,
    electricityBill: 0,
    waterBill: 0,
    internetBill: 0,
    utilityBill: 0,
    serviceCharge: 0,
    maintenanceCharge: 0,
    previousDue: 0,
    totalAmount: 600,
    paymentStatus: 'DUE',
    paidAmount: 0,
    advanceDeducted: 0,
    dueDate: '2026-03-10T00:00:00.000Z',
    paidAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    outstanding: 600,
  },
  invoices: [],
  annualBreakdown: [{ year: 2026, billed: 600, paid: 0, due: 600 }],
  totals: {
    totalBilled: 600,
    totalPaid: 0,
    totalOutstanding: 600,
    accumulatedDue: 0,
    advanceDeposit: 500,
  },
};

/** One flat meter, unread this month — the state the resident acts on. */
export const mockMeter: MeterView = {
  id: 'meter-1',
  flatId: 'flat-1',
  shopId: null,
  meterName: 'Ground floor east',
  meterNumber: 'MTR-0012',
  previousReading: 900,
  currentReading: 1000,
  perUnitRate: null,
  isActive: true,
  createdAt: '2025-01-05T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  unit: { category: 'FLAT', number: 'A-101', label: 'A-101', location: 'Main Building' },
  category: 'FLAT',
  effectiveRate: 10,
  pendingUnits: 100,
  pendingAmount: 1000,
  currentMonthReading: null,
};

const ok = <T>(data: T) => HttpResponse.json({ success: true, data });

export const handlers = [
  http.post(`${API}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { phone: string; password: string };
    if (body.password !== 'Str0ng!Passw0rd') {
      return HttpResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Phone number or password is incorrect' } },
        { status: 401 }
      );
    }
    const user = body.phone.endsWith('0000') ? mockAdmin : mockTenant;
    return ok({ user, accessToken: 'test-access-token' });
  }),

  http.post(`${API}/auth/refresh`, () =>
    HttpResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'No refresh token supplied' } },
      { status: 401 }
    )
  ),

  http.post(`${API}/auth/logout`, () => ok({ message: 'Signed out' })),
  http.get(`${API}/auth/me`, () => ok(mockTenant)),

  http.get(`${API}/rent/my-summary`, () => ok(mockRentSummary)),

  http.post(`${API}/rent/request-due`, async ({ request }) => {
    const { mode } = (await request.json()) as { mode: string };
    const outstanding = 600;
    const advance = 500;
    const deducted = mode === 'DEDUCT_FROM_ADVANCE' ? Math.min(advance, outstanding) : 0;
    const rolled = outstanding - deducted;
    return ok({
      invoice: mockRentSummary.currentInvoice,
      tenancy: mockRentSummary.tenancy,
      settlement: {
        advanceDeducted: deducted,
        newAdvanceDeposit: advance - deducted,
        rolledOver: rolled,
        newAccumulatedDue: rolled,
        paymentStatus: rolled === 0 ? 'DEDUCTED_FROM_ADVANCE' : deducted > 0 ? 'PARTIAL' : 'DUE',
      },
      message: 'Deferral applied',
    });
  }),

  http.get(`${API}/meters/my`, () =>
    ok({
      unit: mockRentSummary.unit,
      month: 3,
      year: 2026,
      meters: [mockMeter],
    })
  ),

  http.post(`${API}/meters/:id/readings`, async ({ request }) => {
    const { currentReading } = (await request.json()) as { currentReading: number };
    const unitsConsumed = currentReading - mockMeter.currentReading;
    return ok({
      meter: { ...mockMeter, previousReading: mockMeter.currentReading, currentReading },
      reading: {
        id: 'reading-1',
        meterId: mockMeter.id,
        month: 3,
        year: 2026,
        previousReading: mockMeter.currentReading,
        currentReading,
        unitsConsumed,
        perUnitRate: mockMeter.effectiveRate,
        amount: unitsConsumed * mockMeter.effectiveRate,
        recordedById: mockTenant.id,
        recordedByName: mockTenant.fullName,
        recordedByRole: 'USER',
        invoiceId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      corrected: false,
    });
  }),

  http.get(`${API}/tickets`, () =>
    ok({ tickets: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } })
  ),

  http.post(`${API}/tickets`, () =>
    ok({
      id: 'ticket-1',
      userId: 'tenant-1',
      flatId: 'flat-1',
      category: 'WATER_LEAKAGE',
      description: 'Water leaking from the bathroom ceiling every night.',
      imageUrl: null,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  ),

  http.get(`${API}/admin/analytics`, () =>
    ok({
      range: { from: '2026-01-01', to: '2026-12-31' },
      series: [
        { key: '2026-01', year: 2026, month: 1, label: 'Jan 2026', revenue: 20000, expenses: 5000, profit: 15000, billed: 22000, collected: 22000, outstanding: 0 },
        { key: '2026-02', year: 2026, month: 2, label: 'Feb 2026', revenue: 20000, expenses: 3000, profit: 17000, billed: 22000, collected: 22000, outstanding: 0 },
      ],
      totals: {
        totalRevenue: 40000,
        totalExpenses: 8000,
        netProfit: 32000,
        totalBilled: 44000,
        totalCollected: 44000,
        totalOutstanding: 0,
      },
      expenseByCategory: [{ category: 'Electricity', amount: 5000 }],
      occupancy: { flats: 6, occupied: 3, vacant: 3, rate: 50 },
      counts: { tenants: 4, pendingApprovals: 1, openTickets: 2 },
    })
  ),
];
