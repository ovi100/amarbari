import api, { unwrap } from './api';
import type {
  Analytics,
  BuildingExpense,
  ChatMessage,
  Conversation,
  DeferralMode,
  DeferralSettlement,
  Flat,
  Invoice,
  MaintenanceTicket,
  Pagination,
  RentSummary,
  TableDescriptor,
  TablePage,
  Tenancy,
  TicketStatus,
  User,
} from '@/types';

// --- Auth -------------------------------------------------------------------

export interface RegisterPayload {
  fullName: string;
  phone: string;
  password: string;
  dob?: string;
  familyMembers: number;
  identityType: string;
  identityNumber: string;
  village: string;
  postOffice: string;
  district: string;
  policeStation: string;
  division: string;
}

export const authApi = {
  register: (payload: RegisterPayload) =>
    unwrap<{ user: User; otp: { expiresInSeconds: number; delivered: boolean; devCode?: string }; message: string }>(
      api.post('/auth/register', payload)
    ),

  sendOtp: (phone: string, channel: 'WHATSAPP' | 'IMO' = 'WHATSAPP') =>
    unwrap<{ expiresInSeconds: number; delivered: boolean; devCode?: string; message: string }>(
      api.post('/auth/send-otp', { phone, channel })
    ),

  verifyOtp: (phone: string, code: string) =>
    unwrap<{ user: User; message: string }>(api.post('/auth/verify-otp', { phone, code })),

  login: (phone: string, password: string) =>
    unwrap<{ user: User; accessToken: string }>(api.post('/auth/login', { phone, password })),

  logout: () => unwrap<{ message: string }>(api.post('/auth/logout')),

  me: () => unwrap<User>(api.get('/auth/me')),
};

// --- Rent -------------------------------------------------------------------

export const rentApi = {
  summary: () => unwrap<RentSummary>(api.get('/rent/my-summary')),

  requestDue: (mode: DeferralMode, invoiceId?: string) =>
    unwrap<{ invoice: Invoice; tenancy: Tenancy; settlement: DeferralSettlement; message: string }>(
      api.post('/rent/request-due', { mode, invoiceId })
    ),
};

// --- Invoices ---------------------------------------------------------------

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const invoiceApi = {
  list: (page = 1, pageSize = 20) =>
    unwrap<{ invoices: Invoice[]; pagination: Pagination }>(
      api.get('/invoices', { params: { page, pageSize } })
    ),

  get: (id: string) => unwrap<Invoice>(api.get(`/invoices/${id}`)),

  create: (payload: {
    flatId: string;
    month: number;
    year: number;
    flatRent?: number;
    electricityBill?: number;
    waterBill?: number;
    internetBill?: number;
    utilityBill?: number;
    dueDate?: string;
  }) => unwrap<Invoice>(api.post('/invoices', payload)),

  pay: (id: string, amount: number) =>
    unwrap<Invoice>(api.post(`/invoices/${id}/payments`, { amount })),

  async download(id: string, format: 'pdf' | 'jpg', label: string) {
    const response = await api.get(`/invoices/${id}/${format}`, { responseType: 'blob' });
    downloadBlob(response.data as Blob, `AmarBari-${label}.${format}`);
  },
};

// --- Tickets ----------------------------------------------------------------

export const ticketApi = {
  list: (filters: { status?: TicketStatus; category?: string; page?: number; pageSize?: number } = {}) =>
    unwrap<{ tickets: MaintenanceTicket[]; pagination: Pagination }>(
      api.get('/tickets', { params: { page: 1, pageSize: 50, ...filters } })
    ),

  create: (payload: { category: string; description: string; image?: File | null }) => {
    const form = new FormData();
    form.append('category', payload.category);
    form.append('description', payload.description);
    if (payload.image) form.append('image', payload.image);
    return unwrap<MaintenanceTicket>(
      api.post('/tickets', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    );
  },

  updateStatus: (id: string, status: TicketStatus) =>
    unwrap<MaintenanceTicket>(api.patch(`/tickets/${id}`, { status })),
};

// --- Chat -------------------------------------------------------------------

export const chatApi = {
  thread: (partnerId?: string) =>
    unwrap<{ partnerId: string; messages: ChatMessage[] }>(
      api.get(partnerId ? `/chat/thread/${partnerId}` : '/chat/thread')
    ),

  send: (message: string, receiverId?: string) =>
    unwrap<{ message: ChatMessage; botReply: ChatMessage | null }>(
      api.post('/chat/messages', { message, receiverId })
    ),

  conversations: () => unwrap<Conversation[]>(api.get('/chat/conversations')),
};

// --- Admin ------------------------------------------------------------------

export const adminApi = {
  tenants: (params: { page?: number; pageSize?: number; status?: 'pending' | 'approved' } = {}) =>
    unwrap<{ tenants: User[]; pagination: Pagination }>(
      api.get('/admin/tenants', { params: { page: 1, pageSize: 50, ...params } })
    ),

  tenant: (id: string) => unwrap<User>(api.get(`/admin/tenants/${id}`)),

  setApproval: (id: string, approved: boolean, reason?: string) =>
    unwrap<{ tenant: User; message: string }>(
      api.patch(`/admin/tenants/${id}/approval`, { approved, reason })
    ),

  deleteTenant: (id: string) => unwrap<{ deleted: string }>(api.delete(`/admin/tenants/${id}`)),

  flats: () => unwrap<Flat[]>(api.get('/admin/flats')),

  createFlat: (payload: { flatNumber: string; floor: number; building: string; baseRent: number }) =>
    unwrap<Flat>(api.post('/admin/flats', payload)),

  updateFlat: (id: string, payload: Partial<Flat>) =>
    unwrap<Flat>(api.patch(`/admin/flats/${id}`, payload)),

  deleteFlat: (id: string) => unwrap<{ deleted: string }>(api.delete(`/admin/flats/${id}`)),

  createTenancy: (payload: {
    userId: string;
    flatId: string;
    startDate?: string;
    advanceDeposit?: number;
  }) => unwrap<Tenancy>(api.post('/admin/tenancies', payload)),

  updateTenancy: (id: string, payload: Partial<Tenancy>) =>
    unwrap<Tenancy>(api.patch(`/admin/tenancies/${id}`, payload)),

  expenses: (page = 1, pageSize = 50) =>
    unwrap<{ expenses: BuildingExpense[]; pagination: Pagination }>(
      api.get('/admin/expenses', { params: { page, pageSize } })
    ),

  createExpense: (payload: {
    category: string;
    amount: number;
    description?: string;
    expenseDate?: string;
    flatId?: string | null;
  }) => unwrap<BuildingExpense>(api.post('/admin/expenses', payload)),

  deleteExpense: (id: string) => unwrap<{ deleted: string }>(api.delete(`/admin/expenses/${id}`)),

  analytics: (range?: { from?: string; to?: string }) =>
    unwrap<Analytics>(api.get('/admin/analytics', { params: range })),

  async exportFinancials(format: 'csv' | 'xlsx', range?: { from?: string; to?: string }) {
    const response = await api.get('/admin/analytics/export', {
      params: { format, ...range },
      responseType: 'blob',
    });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(response.data as Blob, `AmarBari-Financials-${stamp}.${format}`);
  },

  // Dynamic schema management
  tables: () => unwrap<TableDescriptor[]>(api.get('/admin/tables')),

  table: (
    name: string,
    params: { page?: number; pageSize?: number; search?: string; sortBy?: string; sortDir?: 'asc' | 'desc' } = {}
  ) => unwrap<TablePage>(api.get(`/admin/tables/${name}`, { params: { page: 1, pageSize: 25, ...params } })),

  addColumn: (
    table: string,
    payload: { columnName: string; label?: string; type: string; required?: boolean; defaultValue?: string | null }
  ) => unwrap<unknown>(api.post(`/admin/tables/${table}/columns`, payload)),

  dropColumn: (table: string, columnName: string) =>
    unwrap<{ removed: string }>(api.delete(`/admin/tables/${table}/columns/${columnName}`)),

  patchRecord: (table: string, id: string, payload: Record<string, unknown>) =>
    unwrap<Record<string, unknown>>(api.patch(`/admin/tables/${table}/records/${id}`, payload)),

  deleteRecord: (table: string, id: string) =>
    unwrap<{ deleted: string }>(api.delete(`/admin/tables/${table}/records/${id}`)),
};
