export type Role = 'ADMIN' | 'TENANT';
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
  tenancy?: (Tenancy & { flat: Flat }) | null;
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
}

export interface Tenancy {
  id: string;
  userId: string;
  flatId: string;
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
  flatId: string;
  month: number;
  year: number;
  flatRent: number;
  electricityBill: number;
  waterBill: number;
  internetBill: number;
  utilityBill: number;
  previousDue: number;
  totalAmount: number;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  advanceDeducted: number;
  dueDate: string;
  paidAt: string | null;
  createdAt: string;
  outstanding?: number;
  flat?: Flat;
}

export interface RentSummary {
  tenancy: Tenancy & { duration: TenancyDuration };
  flat: Flat;
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
  flat?: Pick<Flat, 'id' | 'flatNumber' | 'floor' | 'building'>;
}

export interface BuildingExpense {
  id: string;
  flatId: string | null;
  category: string;
  amount: number;
  description: string | null;
  expenseDate: string;
  flat?: { flatNumber: string } | null;
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
  occupancy: { flats: number; occupied: number; vacant: number; rate: number };
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
