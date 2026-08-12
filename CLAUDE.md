# AmarBari (আমার বাড়ি) — Property & Rent Management System

## System Architecture & Software Requirements Specification (SRS)

---

## 1. Executive Summary & Overview

**AmarBari** is a modern, decoupled full-stack property and rent management SaaS platform tailored for landlords (Admins) and residents (Users). The system features a decoupled architecture with a standalone SPA frontend powered by React 19, Vite, and TypeScript, communicating over REST APIs and WebSockets with a Node.js/Express backend.

> **Terminology:** the product surface calls every account a **User**. The domain model still uses
> _tenancy_ for the relationship between a user and a flat, and the `Role` enum still has a `TENANT`
> member. "Tenant" in this document means the role, not the UI label.

---

## 2. Technology Stack & Framework Selection

### 2.1 Frontend Architecture (Separated SPA Repository)

- **Core Library & Build Tool:** **React 19 + Vite** with **TypeScript**, routed by **React Router v7**.
  (An earlier draft of this document named Next.js 16; §4, §9 and the CI workflow all describe the
  Vite SPA that was built. See "Notes on the spec" in `README.md`.)
- **State Management:**
  - **Zustand:** Global UI state, authentication session, active chat state.
  - **TanStack Query (React Query v5):** Server state caching, asynchronous data fetching, optimistic UI updates.
- **UI Components & Styling:**
  - **Shadcn UI:** Accessible, re-usable Radix UI primitive components tailored for the Vite React setup.
  - **Tailwind CSS:** Utility-first styling with responsive design tokens.
  - **Lucide React:** Iconography.
- **Form Handling & Validation:** **React Hook Form** paired with **Zod** schema validation.
- **Data Visualization:** **Recharts** for interactive financial and rental analytics dashboards.
- **Real-Time Engine:** **Socket.io-client** for instant messaging, notifications, and real-time maintenance updates.
- **Testing Suite:** **Vitest**, **React Testing Library**, **MSW (Mock Service Worker)**, and **Playwright** for E2E user-flow testing.

#### 2.1.1 Shared UI Primitives

These carry the cross-cutting behaviour required by §3.2.7 and §3.2.8; features build on them
rather than re-implementing grids and filters per page.

| Component                                   | Responsibility                                                                                                   |
| :------------------------------------------ | :--------------------------------------------------------------------------------------------------------------- |
| `components/ui/data-table.tsx`               | The single admin grid: search, sort, paginate, CSV export, row-action menu. See §3.2.7.                           |
| `components/ui/date-range-picker.tsx`        | Inline range filter with presets and a live span summary.                                                        |
| `components/ui/segmented.tsx`                | Single-choice control where every option stays visible and the active one is filled.                             |
| `components/charts/ChartViewToggle.tsx`      | The chart/table switch, built on `Segmented`, shared by every chart card so the affordance is identical.          |
| `components/ui/dropdown-menu.tsx`            | Radix dropdown, used for row-action menus.                                                                       |
| `PasswordInput` in `ui/form-controls.tsx`    | Password field with a reveal toggle. Every password input in the app uses it (§3.1.7).                           |
| `lib/identity.ts`                            | Identity-document rules — pattern, message, placeholder, keyboard and length cap per type (§8.6).                 |
| `lib/schemas.ts`                             | Every Zod form schema. Mirrors `server/src/utils/validators.ts`; the two must change together.                    |

#### 2.1.2 Theming Requirement

`color-scheme` **must** be declared on `:root` (light) and `.dark` (dark) in `index.css`. Browser-painted
widgets — native `<select>` popups, the `<input type="date">` calendar, scrollbars — ignore CSS colours
and follow this property alone. Omitting it renders dropdown lists and the date field's calendar glyph in
the light palette on a dark surface, where they read as missing rather than merely mis-coloured.

### 2.2 Backend Architecture (Separated Node.js API Service)

- **Runtime & Framework:** Node.js with Express.js (TypeScript)
- **Database:** PostgreSQL (Relational Database)
- **ORM:** Prisma ORM (Type-safe database client and migrations)
- **Caching & Session Storage:** Redis (For OTP caching, token blacklisting, and Socket.io adapter)
- **Authentication & Security:** JWT (JSON Web Tokens) with dual-token rotation (Short-lived Access Token + HTTP-only Refresh Token), bcrypt password hashing, and CORS configuration for SPA client.
- **Real-Time Engine:** Socket.io server with authentication middleware.
- **PDF & Image Generation:** `pdfkit` and `@napi-rs/canvas` for server-side PDF invoice and JPG receipt rendering with digital signature overlays.
- **Messaging Integration:** Pluggable OTP dispatch, selected per channel (see §3.1.2):

  | Channel    | Provider                                                    | Configuration                                                            |
  | :--------- | :---------------------------------------------------------- | :------------------------------------------------------------------------ |
  | `WHATSAPP` | `MESSAGING_PROVIDER` — `ultramsg`, `greenapi` or `webhook`   | Provider credentials                                                     |
  | `IMO`      | Always the generic outbound webhook (no public business API) | `MESSAGING_WEBHOOK_URL`                                                  |
  | `SMS`      | **Twilio**, called over its REST API — no SDK dependency     | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and a sender (see below)      |

  Twilio takes either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`; the service SID wins when
  both are set. With credentials absent, SMS **degrades to the `console` provider instead of failing**,
  so local dev and CI never need a paid gateway. That degradation is silent in production — if the SMS
  channel is offered, the credentials must be set.

- **Testing Suite:** **Vitest**, **Supertest**, and an isolated test database. Database-backed specs
  self-skip when no database is reachable, so the unit suites still run on a bare machine.

---

## 3. Comprehensive Feature Matrix

### 3.1 Resident (User) Features

1. **Registration & Profile Management:**
   - Detailed registration fields: Full Name, Phone Number, DOB, Total Family Members.
   - Comprehensive Address Fields: Village/Street, Post Office, District, Police Station (Thana), Division.
   - Identity Verification: Identity Type (`PASSPORT`, `NID`, `BIRTH_CERTIFICATE`) and Identity Number,
     validated **against each other** — the accepted number format depends on the document type
     (NID 10/13/17 digits, passport 9 characters, birth certificate 17 digits). Phone numbers are
     11 digits. Every rule, and where each is enforced, is tabulated in **§8.6**.
2. **OTP Verification:**
   - OTP delivery over **WhatsApp**, **IMO**, or **SMS via Twilio** — the user picks the channel on the
     verification screen and can re-send over a different one.
   - 6-digit dynamic passcode with 3-minute Redis expiration and rate limiting.
3. **Rent & Billing Dashboard:**
   - Itemized monthly & annual rent breakdown:
     - Flat Rent
     - Electricity Bill
     - Water Bill
     - Internet Bill
     - Utility & Service Charge
   - Calculated Tenancy Duration Counter (e.g., "1 Year, 3 Months, 12 Days in this flat").
4. **Advance & Dues System:**
   - Option to defer current month's rent (Due request).
   - Dynamic roll-over: Automatically append unpaid balance to the subsequent month's invoice OR deduct directly from the tenant's pre-paid Advance Deposit balance.
5. **Issue & Maintenance Reporting:**
   - Submit maintenance tickets with category tags (`WINDOW_BROKEN`, `ELECTRICITY_ISSUE`, `FAUCET_BROKEN`, `WATER_LEAKAGE`, `OTHER`), textual description, and picture upload.
   - Real-time status tracker (`PENDING`, `IN_PROGRESS`, `RESOLVED`, `REJECTED`).
6. **Real-Time Admin Chat / Chatbot:**
   - Instant messaging channel directly connecting the resident with the Property Admin.
   - Automated chatbot helper for quick FAQs (Rent payment instructions, emergency contacts, maintenance rules).
7. **Password Visibility:**
   - Every password field in the application — sign-in, registration, confirm-password, and the admin-side
     user forms — exposes a reveal toggle via the shared `PasswordInput`. The toggle is keyboard-operable
     but carries `tabIndex={-1}`, so tabbing runs field → submit without a detour.
8. **Invoice History Grid:**
   - The resident's own invoice history is paginated, searchable and sortable, and exports to CSV, using
     the same `DataTable` as the admin grids (§3.2.7).

### 3.2 Property Owner (Admin) Features

1. **Dynamic Database Column & Schema Management (Admin Data Control):**
   - Direct capability to append, update, or alter any field/column value across all database tables dynamically via dedicated Admin control routes or JSON/PostgreSQL schema extensions.
   - Built-in dynamic data tables and mutation forms on the Admin frontend to inspect and edit raw column attributes across all system entities (`User`, `Flat`, `Tenancy`, `Invoice`, `BuildingExpense`, `MaintenanceTicket`, `ChatMessage`).
2. **User Control & Approval Center (RBAC):**
   - Review pending registrations, verify ID documents, approve/revoke access.
   - **Full user CRUD:** create, edit and delete accounts directly from the admin console. Accounts
     created here bypass self-registration and may be pre-approved and pre-verified, and their role
     (`ADMIN` / `TENANT`) is set on the form.
   - Guards, enforced server-side: phone number and identity number are unique across accounts; an
     admin cannot delete their own account; and the **last remaining admin can be neither demoted nor
     deleted** — either would lock everyone out of the console.
   - Flat allocation and tenancy histories, subject to the assignment invariant in §8.3.
3. **Flat Management:**
   - Create, **edit** and delete units.
   - Assign or release a user from the flat's own row.
   - `isOccupied` is derived from the tenancy ledger and is **not** hand-editable to `false` while a
     tenancy is active — a flat reading "vacant" with somebody still allocated to it corrupts both
     occupancy analytics and the invoice guard in §8.2.
4. **Financial Management & Profit/Expense Analytics:**
   - **Revenue/Profit Engine:** Revenue is derived purely from Base Flat Rent collections.
   - **Expense Engine:** Track operating costs including utility, electricity, internet, and building maintenance expenses.
   - Calculation: `Net Profit = Total Collected Flat Rent - Property Operational Expenses`.
   - Expenses are editable, and the record-expense form offers a **custom category** option for costs
     that no preset category describes.
5. **Graphical Dashboards & Data Export:**
   - Visual charts: Revenue vs. Expense trends (Monthly/Yearly bar & line graphs).
   - Every chart card carries the **same** chart/table switch (`ChartViewToggle`), in the same position.
     Both options are always visible with the active one filled; a lone button that relabels itself is
     ambiguous about whether its label names the current view or the next one.
   - A date-range filter with visible From/To fields and preset buttons (This month, Last 90 days, This
     year, Last year). The fields stay on the page rather than inside a popover: the range is re-aimed
     constantly, and a popover charges a click for every adjustment.
   - Export capabilities: Comprehensive financial statement export in **CSV** and **Excel (.xlsx)** format using `exceljs`.
6. **Maintenance Ticket Resolution Center:**
   - Unified dashboard displaying reporter info, flat number, date, severity, and photo logs.
7. **Universal Data Grid Behaviour:**

   Every admin table is built on `DataTable` and therefore:

   - **Paginates**, with a rows-per-page control.
   - **Sorts** on any column that declares a sort value; clicking cycles ascending → descending → source order.
   - **Searches**, filtering the rows already on the client first and falling back to a database query
     **only when the local filter finds nothing** — so the common case costs no round trip while a record
     outside the loaded page is still reachable. The UI states which of the two produced the results.
   - **Exports** the filtered, sorted set to CSV, BOM-prefixed so Excel reads Bengali text and `৳` correctly.
   - Renders up to two row actions inline and **collapses three or more into a dropdown menu**. The count
     is per row after hidden actions are removed, so a row whose conditional action does not apply keeps
     its inline buttons.

   `DataControlPage` keeps genuine server-side pagination, search and sorting instead: it addresses whole
   tables, which can be far larger than one page. Dynamic columns are not sortable there, since they live
   inside a JSONB blob the database cannot order by.

8. **Invoice & Receipt Generation:**
   - One-click PDF & JPG receipt generation for individual billing cycles.
   - Built-in Admin Digital Signature stamp on all generated invoices.
   - **Detail modal** showing the full line-item breakdown, what has been settled in cash versus deducted
     from advance, and the outstanding balance.
   - **Editable invoices.** The total is always recomputed from the line items server-side rather than
     accepted from the client, and payment status is re-derived from what has actually been settled;
     re-opening a settled invoice clears `paidAt`.
   - Generation is blocked for a flat with no user assigned (§8.2), and requires every charge to be
     stated explicitly (§8.4).

---

## 4. Decoupled System Architecture & Flow

```
+-----------------------------------------------------------------------------------+
|                         FRONTEND CLIENT (Vite + React 19 TS)                     |
|   Shadcn UI | Zustand | TanStack Query | React Router v7 | Socket.io-client       |
+-----------------------------------------------------------------------------------+
                             |                          ^
                    REST API | (HTTPS / JSON)           | Socket.io
                             v                          | WebSockets
+-----------------------------------------------------------------------------------+
|                          BACKEND API SERVICE (Node.js/Express)                    |
|   Express Controllers | RBAC Middleware | Invoice PDF Engine | Socket Server      |
+-----------------------------------------------------------------------------------+
         |                        |                         |
         v                        v                         v
+------------------+     +------------------+      +----------------------+
|  PostgreSQL DB   |     |    Redis Cache   |      |     Third-Party      |
| (Prisma Engine)  |     | (OTP/Sessions)   |      | WhatsApp/IMO/Twilio  |
+------------------+     +------------------+      +----------------------+
```

---

## 5. Prisma Database Schema (`schema.prisma`)

`server/prisma/schema.prisma` is the authority; the excerpt below tracks it. Three things differ from
the original draft of this section and are deliberate:

- Every model carries a **`customFields Json`** column, and a **`DynamicColumn`** registry records the
  admin-defined columns stored inside it. This is how §3.2.1 is implemented — no runtime `ALTER TABLE`.
- `Tenancy.userId` is `@unique` and `Invoice` is unique on `[flatId, month, year]`. These two constraints
  are what make the invariants in §8.2 and §8.3 enforceable rather than merely intended.
- Cascade deletes on `Tenancy`, `MaintenanceTicket` and `ChatMessage` let a user be deleted in one
  transaction.

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooled at runtime
  directUrl = env("DIRECT_URL")     // migrations: pgbouncer cannot run DDL
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  ADMIN
  TENANT
}

enum IdentityType {
  NID
  PASSPORT
  BIRTH_CERTIFICATE
}

enum TicketStatus {
  PENDING
  IN_PROGRESS
  RESOLVED
  REJECTED
}

enum IssueCategory {
  WINDOW_BROKEN
  ELECTRICITY_PROBLEM
  FAUCET_BROKEN
  WATER_LEAKAGE
  OTHER
}

enum PaymentStatus {
  PAID
  DUE
  PARTIAL
  DEDUCTED_FROM_ADVANCE
}

/// Data type of an admin-defined dynamic column (SRS 3.2.1).
enum DynamicColumnType {
  STRING
  NUMBER
  BOOLEAN
  DATE
}

model User {
  id              String         @id @default(uuid())
  fullName        String
  phone           String         @unique
  passwordHash    String
  role            Role           @default(TENANT)
  isPhoneVerified Boolean        @default(false)
  isApproved      Boolean        @default(false)

  // Profile Details
  dob             DateTime?
  familyMembers   Int            @default(1)
  identityType    IdentityType
  identityNumber  String         @unique

  // Address Breakdown
  village         String
  postOffice      String
  district        String
  policeStation   String
  division        String

  // Relationships
  tenancy         Tenancy?
  tickets         MaintenanceTicket[]
  messagesSent    ChatMessage[]  @relation("SentMessages")
  messagesRecv    ChatMessage[]  @relation("ReceivedMessages")

  /// Admin-defined dynamic columns (SRS 3.2.1). Present on every model.
  customFields    Json           @default("{}")

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
}

model Flat {
  id          String    @id @default(uuid())
  flatNumber  String    @unique
  floor       Int
  building    String    @default("Main Building")
  isOccupied  Boolean   @default(false)

  // Base Pricing Structure
  baseRent    Float

  tenancies   Tenancy[]
  invoices    Invoice[]
  tickets     MaintenanceTicket[]
  expenses    BuildingExpense[]

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

/// `userId` is unique: a user holds at most one tenancy record, which is half of
/// the assignment invariant in §8.3. The other half — one *active* tenancy per
/// flat — cannot be expressed as a constraint and is enforced in the transaction.
model Tenancy {
  id             String    @id @default(uuid())
  userId         String    @unique
  flatId         String
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  flat           Flat      @relation(fields: [flatId], references: [id])

  startDate      DateTime  @default(now())
  endDate        DateTime?
  advanceDeposit Float     @default(0.0)
  accumulatedDue Float     @default(0.0)
  isActive       Boolean   @default(true)

  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
}

model Invoice {
  id              String        @id @default(uuid())
  flatId          String
  flat            Flat          @relation(fields: [flatId], references: [id])
  month           Int           // 1 - 12
  year            Int

  // Bill Breakdown
  flatRent        Float
  electricityBill Float        @default(0.0)
  waterBill       Float        @default(0.0)
  internetBill    Float        @default(0.0)
  utilityBill     Float        @default(0.0)
  previousDue     Float        @default(0.0)
  totalAmount     Float

  paymentStatus   PaymentStatus @default(DUE)
  paidAmount      Float         @default(0.0)
  advanceDeducted Float        @default(0.0)
  dueDate         DateTime
  paidAt          DateTime?

  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  /// One invoice per flat per billing month.
  @@unique([flatId, month, year])
  @@index([year, month])
}

model BuildingExpense {
  id          String   @id @default(uuid())
  flatId      String?
  flat        Flat?    @relation(fields: [flatId], references: [id])
  category    String   // e.g. "Electricity", "Water Maintenance", "Internet Trunk"
  amount      Float
  description String?
  expenseDate DateTime @default(now())

  createdAt   DateTime @default(now())
}

model MaintenanceTicket {
  id          String        @id @default(uuid())
  userId      String
  flatId      String
  user        User          @relation(fields: [userId], references: [id])
  flat        Flat          @relation(fields: [flatId], references: [id])
  category    IssueCategory
  description String
  imageUrl    String?
  status      TicketStatus  @default(PENDING)

  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

model ChatMessage {
  id         String   @id @default(uuid())
  senderId   String
  receiverId String
  sender     User     @relation("SentMessages", fields: [senderId], references: [id], onDelete: Cascade)
  receiver   User     @relation("ReceivedMessages", fields: [receiverId], references: [id], onDelete: Cascade)
  message    String
  isBot      Boolean  @default(false)
  read       Boolean  @default(false)

  createdAt  DateTime @default(now())
}

/// Metadata registry backing SRS 3.2.1. Admin-created columns are stored as keys
/// inside each model's `customFields` JSONB blob rather than as physical DDL
/// columns, so extending the schema needs no migration and cannot corrupt the
/// relational core.
model DynamicColumn {
  id           String            @id @default(uuid())
  tableName    String
  columnName   String
  label        String
  type         DynamicColumnType @default(STRING)
  required     Boolean           @default(false)
  defaultValue String?

  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  @@unique([tableName, columnName])
}
```

---

## 6. REST API Endpoint Specification

All list endpoints accept the shared query contract `?page&pageSize&search&sortBy&sortDir`. `sortBy` is
whitelisted per resource — an arbitrary column name is ignored rather than passed to the database.

### 6.1 Auth & Verification

- `POST /api/v1/auth/register` — Register a new user with profile details.
- `POST /api/v1/auth/send-otp` — Trigger an OTP over `WHATSAPP`, `IMO` or `SMS` (cached in Redis for 3 min).
- `POST /api/v1/auth/verify-otp` — Verify phone number via OTP.
- `POST /api/v1/auth/login` — Authenticate user and issue JWT Access + Refresh token.
- `POST /api/v1/auth/refresh` — Refresh expired access token.

### 6.1.1 User Management (Admin)

Mounted at **both** `/api/v1/admin/users` and `/api/v1/admin/tenants`. `/users` is the current name;
`/tenants` is kept as an alias so existing integrations keep working, and list responses carry the same
array under both a `users` and a `tenants` key.

- `GET /api/v1/admin/users` — List users; supports the shared query contract plus `status=pending|approved`
  and `role=ADMIN|TENANT`. Defaults to the `TENANT` roster.
- `POST /api/v1/admin/users` — Create an account, optionally pre-approved and pre-verified.
- `GET /api/v1/admin/users/:id` — Full record including recent tickets and tenancy duration.
- `PATCH /api/v1/admin/users/:id` — Update any profile field, role, approval state, or password.
- `PATCH /api/v1/admin/users/:id/approval` — Approve or revoke access; emits `account:approval` over the socket.
- `DELETE /api/v1/admin/users/:id` — Delete the account, cascade its tenancy/tickets/chat, and release its flat.

### 6.1.2 Flats & Assignment (Admin)

- `GET /api/v1/admin/flats` — List flats with their active tenancy; `?search=` matches flat number,
  building, or the assigned user's name.
- `POST /api/v1/admin/flats` — Create a unit.
- `PATCH /api/v1/admin/flats/:id` — Edit a unit. Rejects `isOccupied: false` while a tenancy is active.
- `POST /api/v1/admin/flats/:id/tenancy` — Assign a user to the flat (§8.3).
- `DELETE /api/v1/admin/flats/:id/tenancy` — End the active tenancy and release the unit.
- `DELETE /api/v1/admin/flats/:id` — Delete the unit; refused while a tenancy is active.

### 6.2 Dynamic Schema & Table Management (Admin)

- `GET /api/v1/admin/tables` — Fetch database table metadata, dynamic schema definitions, and column schemas.
- `GET /api/v1/admin/tables/:tableName` — Query records and dynamic columns for any table.
- `POST /api/v1/admin/tables/:tableName/columns` — Dynamically add a new column/field definition to a database table.
- `PATCH /api/v1/admin/tables/:tableName/records/:id` — Update or populate any column value for a specific record.

### 6.3 Rent & Financials (User & Admin)

- `GET /api/v1/rent/my-summary` — Get the signed-in user's current & historical rent, tenancy duration, active dues, and advance deposit.
- `POST /api/v1/rent/request-due` — User requests current month's rent deferral (roll-over to next month or deduct from advance).
- `GET /api/v1/admin/analytics` — Admin overview of revenue (flat rent) vs expenses (utility/water/electricity) with date range filters.
- `GET /api/v1/admin/analytics/export?format=csv|xlsx` — Stream CSV/Excel report.

### 6.4 Maintenance & Reports

- `POST /api/v1/tickets` — Submit a new maintenance issue report.
- `GET /api/v1/tickets` — Admin fetches all issue reports with filters.
- `PATCH /api/v1/tickets/:id` — Admin updates ticket status (`IN_PROGRESS`, `RESOLVED`, `REJECTED`).

### 6.5 Invoices & Receipts

- `GET /api/v1/invoices` — Admin list; shared query contract, with `search` matching flat number,
  building or the assigned user's name.
- `POST /api/v1/invoices` — Generate a monthly invoice. **400** if the flat has no active tenancy (§8.2);
  **409** if one already exists for that flat and month.
- `GET /api/v1/invoices/:id` — Invoice detail including the flat and its current occupant.
- `PATCH /api/v1/invoices/:id` — Edit line items and due date. Recomputes `totalAmount` and re-derives
  `paymentStatus` from what has been settled (§8.5).
- `POST /api/v1/invoices/:id/payments` — Record a payment against the invoice.
- `GET /api/v1/invoices/:id/pdf` — Render & download the invoice as PDF.
- `GET /api/v1/invoices/:id/jpg` — Render & download the invoice receipt image.

### 6.6 Expenses (Admin)

- `GET /api/v1/admin/expenses` — Shared query contract; `search` matches category, description and flat number.
- `POST /api/v1/admin/expenses` — Record an expense under a preset or custom category.
- `PATCH /api/v1/admin/expenses/:id` — Edit an expense.
- `DELETE /api/v1/admin/expenses/:id` — Delete an expense.

---

## 7. Comprehensive Testing Strategy & Quality Assurance Matrix

### 7.1 Automated Testing Architecture

To guarantee end-to-end reliability, security, and smooth user experience across both frontend and backend from every angle of user (Tenant and Admin):

1. **End-to-End (E2E) Journey Tests (Playwright):**
   - **Resident Angle:** Registration flow with complete address details, OTP submission, rent deferral
     selection (Advance deduction vs. roll-over), maintenance photo submission, and live WebSocket chat.
   - **Admin Angle:** User review and approval workflow (via the row-action menu), graphical dashboard
     inspection, date-range preset filtering, exporting financial CSV/Excel sheets, generating signed
     PDF/JPG receipts, and resolving tickets.
2. **Frontend Unit & Integration Tests (Vitest + React Testing Library + MSW):**
   - Form schema validation tests with Zod and React Hook Form — including that a **blank** money field
     is rejected while a stated `0` is accepted (§8.4).
   - **Identity validation as a table-driven matrix** (§8.6): each document type against valid and
     invalid lengths, the same number accepted under one type and rejected under another, separator
     stripping and upper-casing, and that the error message names the expected format.
   - Phone lengths (10 / 11 / 12 digits, operator prefixes, the `+880` and `880` forms).
   - The remaining field rules: names with digits, under-18 dates of birth, zero base rent, future-dated
     expenses, over-payment beyond the outstanding balance, and ticket-photo type and size.
   - `DataTable` behaviour: sort cycling, numeric vs. lexical ordering, local filtering, the database
     fallback firing only on a local miss, pagination boundaries, and the inline-vs-menu action
     threshold counted per row.
   - Shared controls: `PasswordInput` masking/reveal and its tab behaviour; `DateRangePicker` presets
     driving both date fields.
   - Overview integration: both chart cards exposing the identical view switch, and switching to table
     and back.
   - Global Zustand store state mutation tests (auth sessions, dynamic theme, chat status).
   - Mocking backend APIs via MSW to test TanStack Query state caching and UI error states.
3. **Backend API & Business Logic Tests (Vitest + Supertest):**
   - **RBAC Security:** Ensure unauthorized roles receive `403 Forbidden` on protected admin endpoints,
     including the user-management routes.
   - **Rent & Advance Math Engine:** Test calculations when deducting rent from advance balances vs. carrying over unpaid balances to `accumulatedDue`.
   - **User CRUD:** creation, edit, deletion, duplicate phone/identity rejection, and the last-admin guard.
   - **Identity pairing across all three enforcement points** (§8.6): a mismatched type/number pair
     refused at create; a patch that changes only the type re-checked against the stored number; and the
     same guard exercised through the raw Data Control record editor.
   - **Validator unit tests:** the identity matrix, phone canonicalisation to `+8801XXXXXXXXX`, and the
     server password rule matching the client's.
   - **Assignment invariant (§8.3):** double-booking a flat and double-housing a user both rejected;
     release-then-reassign reusing the existing tenancy row.
   - **Invoice rules:** vacant-flat generation refused and no row written; edit recalculating total,
     status and `paidAt`.
   - **Messaging:** Twilio request shape (basic auth, `From` vs. `MessagingServiceSid`), failure
     reported rather than thrown, and the console fallback when unconfigured.
   - **PDF/JPG Renderer:** Validate that server-rendered buffers output valid PDF/JPG buffers with signatures without memory leaks.

> Database-backed specs self-skip when no database is reachable, so they pass vacuously on a machine
> without Postgres. **CI is the only place they actually assert.** Treat a green local run as covering
> the unit suites only.

### 7.2 Manual Testing & QA Matrix

| Category                            | Test Scenario                                                                            | Expected Outcome                                                                                                        |
| :---------------------------------- | :--------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **RBAC Security**                   | A resident attempts to access `/admin/analytics` directly via client URL or REST request. | Client redirects to unauthorized view or API responds with HTTP `403 Forbidden`.                                        |
| **Rent Deferral (Advance Deposit)** | User with $500 advance deposit defers a $600 rent bill.                                  | $500 deducted from advance balance, remaining $100 appended to `accumulatedDue` for next billing cycle.                 |
| **Real-time Messaging**             | User and Admin message each other simultaneously across different browsers.              | WebSocket delivers messages instantaneously without manual page reload; fallback to long polling if socket disconnects. |
| **Data Export**                     | Admin exports financial statements containing 1,000+ invoice records to Excel (`.xlsx`). | Server streams file cleanly via `exceljs` without memory bottlenecks or corrupted spreadsheet formatting.               |
| **Mobile Responsiveness**           | User accesses dashboard on small screens.                                                | Navigation drawer collapses gracefully and forms adjust to mobile viewport touch targets.                               |
| **Dark Mode Widgets**               | In dark mode, open any `<select>` and click into a date field.                            | The option list and the calendar popup render dark, and the calendar glyph is visible. Regression guard for `color-scheme`. |
| **Vacant-Flat Invoicing**           | Admin tries to generate an invoice for a flat with nobody assigned.                       | The flat is absent from the picker, and a direct API call returns `400` with no invoice row written.                    |
| **Incomplete Invoice**              | Admin submits the generate-invoice form leaving the water bill untouched.                 | Submission is blocked with a field error; entering `0` is accepted.                                                     |
| **Duplicate Assignment**            | Admin assigns a second user to an occupied flat, or a housed user to a second flat.       | `409` naming the existing occupant / the user's current flat. No tenancy row is created.                                |
| **Last Admin**                      | The only remaining admin tries to demote or delete their own account.                     | Rejected, so the console can never become unreachable.                                                                  |
| **Grid Search Fallback**            | Admin searches a grid for a record that is not on the loaded page.                         | Local filter misses, the database is queried, and the UI says the result came from beyond the loaded page.              |
| **Export Encoding**                 | Admin exports a grid containing Bengali names to CSV and opens it in Excel.                | Text renders correctly — the file is written with a UTF-8 BOM.                                                          |
| **Identity/Type Pairing**           | Register with type `PASSPORT` and a 13-digit NID number.                                   | Rejected on the number field, naming the 9-character rule. Switching the type to `NID` accepts the same number.         |
| **Identity Normalisation**          | Enter a passport number as `bm 0099-231`.                                                  | Accepted and stored as `BM0099231`.                                                                                     |
| **Phone Length**                    | Register with a 10- or 12-digit mobile number.                                             | Rejected, naming the 11-digit rule. `+880` and `880` forms of a valid number are accepted.                              |
| **Overpayment**                     | Record a payment larger than the invoice's outstanding balance.                            | Rejected before submission, naming the outstanding figure.                                                              |

### 7.3 CI/CD Automated Testing Pipeline Workflow (`.github/workflows/test.yml`)

The committed workflow is the authority; the sketch below shows its shape — tests first, build only if
they pass. The real file also runs on `push`, pins Node 22, adds service health checks, and provides the
`DATABASE_URL` that lets the database-backed specs actually assert.

```yaml
name: Continuous Testing Pipeline

on:
  pull_request:
    branches: [main, master, develop]

jobs:
  backend-tests-and-build:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        ports: ["5432:5432"]
        env:
          POSTGRES_DB: amarbari_test
          POSTGRES_PASSWORD: password
      redis:
        image: redis:alpine
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - run: cd server && npm ci
      - run: cd server && npx prisma migrate reset --force
      # Step 1: Run tests first
      - run: cd server && npm run test
      # Step 2: Build project ONLY if tests pass
      - run: cd server && npm run build

  frontend-tests-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd client && npm ci
      # Step 1: Run unit/integration tests first
      - run: cd client && npm run test
      # Step 2: Build production SPA assets ONLY if tests pass
      - run: cd client && npm run build

  e2e-tests:
    needs: [backend-tests-and-build, frontend-tests-and-build]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run e2e:playwright
```

---

## 8. Key Algorithmic & Workflow Logic

### 8.1 Rent Deferral & Advance Settlement Algorithm

When a tenant opts to mark current month's rent as **DUE**:

1. Check if tenant has available `advanceDeposit` in `Tenancy`.
2. **Option A (Deduct from Advance):**
   - If `advanceDeposit >= totalAmount`:
     - Subtract `totalAmount` from `advanceDeposit`.
     - Set `Invoice.advanceDeducted = totalAmount`.
     - Set `Invoice.paymentStatus = DEDUCTED_FROM_ADVANCE`.
3. **Option B (Roll-over to Next Month):**
   - Append `totalAmount` to `Tenancy.accumulatedDue`.
   - When generating next month's invoice, `previousDue = Tenancy.accumulatedDue`.

### 8.2 Invoice Generation Guard

`generateInvoice` refuses (400) any flat whose `tenancies` contain no active record:

> A bill needs somebody to bill. Invoicing a vacant unit produces a receivable nobody owes, and it
> skews every revenue, outstanding and occupancy figure downstream.

The admin form reinforces this by listing only occupied flats, and states how many vacant flats it
hid and why, rather than letting the choice be made and then rejected.

### 8.3 Flat Assignment Invariant

**One user per flat, one flat per user.** Both halves are checked inside the same transaction as the
write, so two concurrent allocations cannot slip a second occupant into a unit:

1. Reject if the flat already has an active tenancy — naming the current occupant.
2. Reject if the user already has an active tenancy — naming the flat they are in.
3. A previous, *ended* tenancy occupies the unique `userId` slot, so re-assigning that user updates
   that row rather than inserting a second one.
4. Mark the flat occupied.

Releasing reverses it: the tenancy is closed with an `endDate` and the flat is marked vacant. Invoice
history survives both operations.

### 8.4 Complete-Invoice Rule

Every money field on the generate/edit invoice form is required, **including the ones that are zero** —
the admin states "water is 0 this month" rather than skipping the field, because a blank charge and a
stated zero are different claims.

Implementation note, and the source of the original defect: the validator uses `z.preprocess` to map an
empty value to `NaN`, **not** `z.coerce.number()`. Zod's coercion turns `''` into `0`, so an untouched
field validated as a stated zero and the rule silently did nothing. The server keeps its `0` defaults so
the API stays usable for programmatic callers.

### 8.5 Invoice Edit Recalculation

On `PATCH /invoices/:id` the server never trusts a client-supplied total:

1. Merge the submitted line items over the stored ones.
2. `totalAmount` = sum of the merged lines.
3. `settled` = `paidAmount + advanceDeducted`, which the edit does not touch.
4. Re-derive status: `settled >= total && settled > 0` → `PAID`; `settled > 0` → `PARTIAL`; else `DUE`.
5. `paidAt` is cleared unless the result is `PAID`, so re-opening a settled invoice cannot leave a stale
   settlement date behind.

### 8.6 Input Validation Rules

Every rule below is enforced **twice** — in `client/src/lib/schemas.ts` so the user is corrected before
the round trip, and in `server/src/utils/validators.ts` so the API cannot be talked past. The two files
are mirrors; changing one without the other creates a value the UI refuses but the API accepts.

**Identity documents** (`client/src/lib/identity.ts` ↔ `IDENTITY_PATTERNS`):

| Type                | Rule                                  | Example             |
| :------------------ | :------------------------------------ | :------------------ |
| `NID`               | 10, 13 or 17 digits                   | `1990021800111`     |
| `PASSPORT`          | Exactly 9 letters/digits              | `BM0099231`         |
| `BIRTH_CERTIFICATE` | Exactly 17 digits                     | `20010725778812901` |

NID accepts three lengths because the 10-digit smart card and the 13- and 17-digit legacy formats are
all still in circulation. Numbers are normalised — separators stripped, upper-cased — before matching,
so a number copied off a physical document validates.

This is a **cross-field** rule: which numbers are valid depends on the type selected, so it lives in a
`superRefine` on the object rather than on the number field. Three consequences:

1. The form's hint text, `inputMode`, `maxLength` and placeholder are driven from the same table, so the
   field guides input rather than only rejecting it afterwards.
2. `PATCH /admin/users/:id` may carry only one half of the pair. The controller re-checks the submitted
   half against the stored other half — the schema alone cannot.
3. The Data Control record editor is a back door into the same columns, so `updateRecord` re-checks it
   there too.

**Other field rules:**

| Field                | Rule                                                                             |
| :------------------- | :-------------------------------------------------------------------------------- |
| Phone                | 11 digits nationally: `01[3-9]` + 8 digits. `+880` / `880` accepted, stored as `+880…` |
| Password             | 8–128 chars, at least one letter and one digit — **identical on both sides**       |
| Full name            | 3–120 chars, must contain a letter, must not contain a digit. Any script          |
| Date of birth        | A real date, not in the future, ≥ 1900, and at least 18 years ago                 |
| Address lines        | 2–120 characters                                                                  |
| Flat number          | 1–20 chars, starts alphanumeric, then letters/digits/space/`-`/`/`                |
| Base rent            | Greater than zero — a unit with no rent contributes nothing to revenue            |
| Money fields         | 0 ≤ x ≤ 100,000,000, catching a slipped extra digit                               |
| Expense amount       | Greater than zero, and not dated in the future (a cost already incurred)          |
| Payment amount       | Greater than zero and **not more than the invoice's outstanding balance**         |
| Tenancy start date   | ≥ 1990 and at most one year ahead                                                 |
| Ticket photo         | JPEG/PNG/WebP, ≤ 5 MB — mirrors the multer filter in `middlewares/upload.ts`      |

> The password rule was previously weaker on the server than in the UI, so a password the form refused
> could still be set through the API. Keep them in step.

### 8.7 Real-Time Messaging & Chatbot Engine

- Socket.io instance authenticates via JWT token handshake.
- Room strategy: `room_user_{tenantId}` and `room_admin_global`.
- Integrated automated bot responds to standard keywords (`/rent`, `/due`, `/contact`, `/rules`) before routing to live Admin agent.

### 8.8 Grid Search Fallback

`DataTable` resolves a search in two stages:

1. Filter the rows already held on the client.
2. **Only if that yields nothing**, call `onServerSearch`, which queries the database across the whole
   table rather than the loaded page.

The common case therefore costs no network round trip, while a record outside the loaded page remains
findable. The UI says which stage produced the rows on screen.

---

## 9. Separated Directory Structure

```
amar-bari/
├── client/                     # Standalone React 19 + Vite Frontend SPA
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   │   ├── charts/         # RevenueExpenseChart, ExpenseCategoryChart,
│   │   │   │                   #   ChartViewToggle (shared chart/table switch)
│   │   │   ├── layout/         # AppLayout — role-aware nav shell
│   │   │   └── ui/             # Shadcn primitives + data-table, date-range-picker,
│   │   │                       #   dropdown-menu, segmented, form-controls
│   │   ├── hooks/              # Custom Hooks (useSocket, useAuth)
│   │   ├── lib/                # schemas.ts (every Zod form schema),
│   │   │                       #   identity.ts (§8.6 document rules), utils.ts
│   │   ├── pages/
│   │   │   ├── admin/          # AdminDashboard, UsersPage, FlatsPage, InvoicesPage,
│   │   │   │                   #   ExpensesPage, AdminTicketsPage, AdminChatPage,
│   │   │   │                   #   DataControlPage
│   │   │   ├── auth/           # Login, Register, VerifyOtp
│   │   │   └── tenant/         # Resident dashboard, rent, issues, chat, profile
│   │   ├── routes/             # React Router v7 Configuration & Role Guards
│   │   ├── services/           # Axios Base Client & API Call Modules
│   │   ├── store/              # Zustand Global Stores
│   │   ├── tests/              # Vitest specs: schemas, DataTable, form-controls,
│   │   │                       #   AdminDashboard, guards, stores, MSW handlers
│   │   ├── types/              # Shared TypeScript Type Declarations
│   │   ├── index.css           # Design tokens + the color-scheme declarations (§2.1.2)
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── index.html
│   └── vite.config.ts
│
├── server/                     # Standalone Node.js + Express Backend API
│   ├── src/
│   │   ├── controllers/        # Express Route Handlers
│   │   ├── middlewares/        # JWT Auth, Role Guard, CORS, Rate Limiter
│   │   ├── routes/             # REST Route Definitions
│   │   ├── services/           # OTP Generator, PDF/JPG Engine, WhatsApp API
│   │   ├── sockets/            # Socket.io Real-time Handlers
│   │   ├── utils/              # validators.ts (mirrors client/src/lib/schemas.ts
│   │   │                       #   + identity.ts), Excel exporters, Prisma client
│   │   └── server.ts           # Application Entry Point
│   ├── tests/                  # Supertest API suites, validators.spec, messaging.spec,
│   │                           #   rent engine, chatbot, document rendering
│   ├── prisma/
│   │   └── schema.prisma       # Database Schema Definition
│   ├── package.json
│   └── tsconfig.json
│
└── e2e/                        # Playwright E2E Cross-Role Test Suite
    ├── tests/
    │   ├── tenant-flow.spec.ts # Resident journey
    │   └── admin-flow.spec.ts
    └── playwright.config.ts
```

---

## 10. Revision Record

### 2026-08-12 — Admin console overhaul

Fixes to reported defects:

| Area                        | Change                                                                                                                       | Spec |
| :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :--- |
| Chart/table switch          | One shared `ChartViewToggle` on every chart card, replacing a self-relabelling button. Expenses card gained a table view.     | §3.2.5 |
| Date filter & presets       | `DateRangePicker` with visible fields, preset buttons and a span summary. Presets are now buttons, not ghost text.            | §3.2.5 |
| Dark-mode widgets           | `color-scheme` declared per theme. This — not a missing control — is why the date field's calendar glyph appeared absent.     | §2.1.2 |
| Vacant-flat invoicing       | Refused server-side; the picker hides vacant flats and explains the omission.                                                 | §8.2 |
| Incomplete invoices         | All money fields required. Root cause was `z.coerce.number()` mapping `''` to `0`; now `z.preprocess` → `NaN`.                | §8.4 |

Additions:

| Area                | Change                                                                                                     | Spec |
| :------------------ | :---------------------------------------------------------------------------------------------------------- | :--- |
| Terminology         | UI says "Users"; route `/admin/users`, with `/admin/tenants` redirecting and the API alias retained.        | §1, §6.1.1 |
| User CRUD           | Create/edit/delete accounts, with uniqueness, self-delete and last-admin guards.                            | §3.2.2 |
| Password visibility | Shared `PasswordInput` on every password field.                                                             | §3.1.7 |
| Twilio SMS          | `SMS` OTP channel over Twilio's REST API, degrading to `console` when unconfigured.                         | §2.2 |
| Data grids          | `DataTable`: pagination, sorting, two-stage search, CSV export, action menu past two actions.               | §3.2.7, §8.8 |
| Invoice detail/edit | Detail modal and server-recalculated editing.                                                               | §3.2.8, §8.5 |
| Flat management     | Editable flats, assign/release from the flat row, one-user-per-flat invariant.                              | §3.2.3, §8.3 |
| Expenses            | Editable, with a custom-category option.                                                                    | §3.2.4 |

**Not migrated:** the maintenance centre remains a card grid rather than a data table — reporter,
description and photo evidence do not compress into table rows usefully.

### 2026-08-12 — Form validation pass

Per-document identity validation (NID 10/13/17 digits, passport 9 characters, birth certificate 17
digits) enforced as a cross-field rule on the client, the API, and the raw record editor, with the form
field's hint, keyboard and length cap driven from the same table. Phone stated as 11 digits. Every other
form tightened in the same pass — name, date of birth (18+), address lines, flat number and rent,
expense amount and date, payment ceiling, tenancy start date, and the ticket photo. Full table in §8.6.

The server's password rule was **weaker than the client's** (no letter/digit requirement), so a password
the UI refused could be set through the API. They now match.

Existing fixtures carried placeholder identity numbers (`NID-1990-000111`) that the new rules reject;
seed data, test factories and E2E helpers were updated to well-formed numbers.

---

_Generated by AmarBari System Design Engine._
