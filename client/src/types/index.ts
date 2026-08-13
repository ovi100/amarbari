export type Role = 'ADMIN' | 'USER';
export type RentCategory = 'FLAT' | 'SHOP';
export type IdentityType = 'NID' | 'PASSPORT' | 'BIRTH_CERTIFICATE';
export type TicketStatus = 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
export type IssueCategory =
  | 'WINDOW_BROKEN'
  | 'ELECTRICITY_PROBLEM'
  | 'FAUCET_BROKEN'
  | 'WATER_LEAKAGE'
  | 'OTHER';
export type PaymentStatus = 'PAID' | 'DUE' | 'PARTIAL' | 'DEDUCTED_FROM_ADVANCE';
export type DeferralMode = 'DEDUCT_FROM_ADVANCE' | 'ROLLOVER';

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[] | unknown;
  };
}

export interface User {
  id: string;
  fullName: string;
  phone: string;
  role: Role;
  isPhoneVerified: boolean;
  isApproved: boolean;
  dob: string | null;
  familyMembers: number;
  identityType: IdentityType;
  identityNumber: string;
  village: string;
  postOffice: string;
  district: string;
  policeStation: string;
  division: string;
  createdAt: string;
  tenancy?: (Tenancy & { flat: Flat | null; shop?: Shop | null }) | null;
}

/** Type-agnostic view of a rented unit — mirrors `UnitSummary` on the server. */
export interface UnitSummary {
  category: RentCategory;
  number: string;
  label: string;
  location: string;
}

/** A commercial unit — the other rent category alongside `Flat`. */
export interface Shop {
  id: string;
  shopName: string;
  shopNumber: string;
  address: string;
  isOccupied: boolean;
  baseRent: number;
  createdAt: string;
  updatedAt: string;
  tenancies?: (Tenancy & { user: Pick<User, 'id' | 'fullName' | 'phone'> })[];
  meters?: Meter[];
}

export interface Flat {
  id: string;
  flatNumber: string;
  floor: number;
  building: string;
  isOccupied: boolean;
  baseRent: number;
  createdAt: string;
  updatedAt: string;
  tenancies?: (Tenancy & { user: Pick<User, 'id' | 'fullName' | 'phone'> })[];
  meters?: Meter[];
}

/**
 * An electricity meter. Assigned to a flat *or* a shop, or to neither while it
 * waits in the pool — reassigning an assigned meter is refused until it is
 * released.
 */
export interface Meter {
  id: string;
  flatId: string | null;
  shopId: string | null;
  meterName: string;
  meterNumber: string;
  currentReading: number;
  previousReading: number;
  /** Null means "follow the category default" — 10 for a flat, 15 for a shop. */
  perUnitRate: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What the API returns for a meter: the row plus its resolved unit and tariff. */
export interface MeterView extends Meter {
  unit: UnitSummary | null;
  category: RentCategory | null;
  effectiveRate: number;
  /** Consumption implied by the dial as it stands, before a reading is filed. */
  pendingUnits: number;
  pendingAmount: number;
  /** Present on the resident's own list. */
  currentMonthReading?: MeterReading | null;
}

/** One meter, one billing month — the evidence behind an electricity charge. */
export interface MeterReading {
  id: string;
  meterId: string;
  month: number;
  year: number;
  previousReading: number;
  currentReading: number;
  unitsConsumed: number;
  perUnitRate: number;
  amount: number;
  recordedById: string | null;
  recordedByName: string;
  recordedByRole: Role;
  invoiceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeterReportMonth {
  month: number;
  label: string;
  previousReading: number | null;
  currentReading: number | null;
  unitsConsumed: number;
  perUnitRate: number | null;
  amount: number;
  recordedByName: string | null;
  recordedAt: string | null;
  invoiceId: string | null;
}

export interface MeterReport {
  meter: MeterView;
  year: number;
  availableYears: number[];
  months: MeterReportMonth[];
  yearTotals: {
    unitsConsumed: number;
    amount: number;
    monthsRecorded: number;
    closingReading: number;
    openingReading: number | null;
  };
  yearly: {
    year: number;
    unitsConsumed: number;
    amount: number;
    closingReading: number;
    months: number;
  }[];
  currentReading: number;
}

/** The metered electricity charge for one unit and month (SRS 8.11). */
export interface ElectricityCharge {
  amount: number;
  units: number;
  lines: {
    meterId: string;
    meterNumber: string;
    meterName: string;
    previousReading: number;
    currentReading: number;
    unitsConsumed: number;
    perUnitRate: number;
    amount: number;
    /** False when no reading was filed and the live dial was used instead. */
    fromReading: boolean;
  }[];
  missingReadings: string[];
}

export interface MeterSummary {
  month: number;
  year: number;
  meters: number;
  assigned: number;
  unassigned: number;
  readingsFiled: number;
  unitsConsumed: number;
  amount: number;
}

/** One entry in the audit trail (SRS 3.2.10). */
export interface ActivityLogEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  actorRole: Role;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export interface Tenancy {
  id: string;
  userId: string;
  /** Exactly one of these is set — a tenancy is on a flat or on a shop. */
  flatId: string | null;
  shopId: string | null;
  startDate: string;
  endDate: string | null;
  advanceDeposit: number;
  accumulatedDue: number;
  isActive: boolean;
}

export interface TenancyDuration {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  label: string;
}

export interface Invoice {
  id: string;
  flatId: string | null;
  shopId: string | null;
  month: number;
  year: number;
  flatRent: number;
  electricityBill: number;
  waterBill: number;
  internetBill: number;
  utilityBill: number;
  /** Shop-only lines; 0 on a flat invoice. */
  serviceCharge: number;
  maintenanceCharge: number;
  previousDue: number;
  totalAmount: number;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  advanceDeducted: number;
  dueDate: string;
  paidAt: string | null;
  createdAt: string;
  outstanding?: number;
  flat?: Flat | null;
  shop?: Shop | null;
}

export interface RentSummary {
  tenancy: Tenancy & { duration: TenancyDuration };
  /** Type-agnostic view of the rented unit. */
  unit: UnitSummary;
  flat: Flat | null;
  shop?: Shop | null;
  currentInvoice: (Invoice & { outstanding: number }) | null;
  invoices: (Invoice & { outstanding: number })[];
  annualBreakdown: { year: number; billed: number; paid: number; due: number }[];
  totals: {
    totalBilled: number;
    totalPaid: number;
    totalOutstanding: number;
    accumulatedDue: number;
    advanceDeposit: number;
  };
}

export interface DeferralSettlement {
  advanceDeducted: number;
  newAdvanceDeposit: number;
  rolledOver: number;
  newAccumulatedDue: number;
  paymentStatus: PaymentStatus;
}

export interface MaintenanceTicket {
  id: string;
  userId: string;
  flatId: string;
  category: IssueCategory;
  description: string;
  imageUrl: string | null;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  user?: Pick<User, 'id' | 'fullName' | 'phone'>;
  flat?: Pick<Flat, 'id' | 'flatNumber' | 'floor' | 'building'> | null;
  shop?: Pick<Shop, 'id' | 'shopNumber' | 'shopName' | 'address'> | null;
}

export interface BuildingExpense {
  id: string;
  flatId: string | null;
  shopId?: string | null;
  category: string;
  amount: number;
  description: string | null;
  expenseDate: string;
  flat?: { flatNumber: string } | null;
  shop?: { shopNumber: string; shopName: string } | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  message: string;
  isBot: boolean;
  read: boolean;
  createdAt: string;
  sender?: { id: string; fullName: string; role: Role };
}

export interface Conversation {
  tenant: { id: string; fullName: string; phone: string; flatNumber: string | null };
  lastMessage: ChatMessage | null;
  unread: number;
}

export interface MonthlyPoint {
  key: string;
  year: number;
  month: number;
  label: string;
  revenue: number;
  expenses: number;
  profit: number;
  billed: number;
  collected: number;
  outstanding: number;
}

export interface Analytics {
  range: { from: string; to: string };
  series: MonthlyPoint[];
  totals: {
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    totalBilled: number;
    totalCollected: number;
    totalOutstanding: number;
  };
  expenseByCategory: { category: string; amount: number }[];
  occupancy: {
    /** Portfolio-wide totals across both rent categories. */
    flats: number;
    occupied: number;
    vacant: number;
    rate: number;
    byCategory?: Record<RentCategory, { total: number; occupied: number }>;
  };
  counts: { tenants: number; pendingApprovals: number; openTickets: number };
}

export interface ColumnMeta {
  name: string;
  type: string;
  kind: 'scalar' | 'enum' | 'object' | 'unsupported';
  isRequired: boolean;
  isId: boolean;
  isUnique: boolean;
  isList: boolean;
  isReadOnly: boolean;
  isDynamic: boolean;
  enumValues?: string[];
  label?: string;
  defaultValue?: string | null;
}

export interface TableDescriptor {
  name: string;
  recordCount: number;
  columns: ColumnMeta[];
}

export interface TablePage {
  table: string;
  columns: ColumnMeta[];
  records: Record<string, unknown>[];
  pagination: Pagination;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
