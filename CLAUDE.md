# AmarBari (আমার বাড়ি) — Property & Rent Management System

## System Architecture & Software Requirements Specification (SRS)

---

## 1. Executive Summary & Overview

**AmarBari** is a modern, decoupled full-stack property and rent management SaaS platform tailored for landlords (Admins) and tenants (Users). The system features a decoupled architecture with a standalone SPA frontend powered by React 19, Vite, and TypeScript, communicating over REST APIs and WebSockets with a Node.js/Express backend.

---

## 2. Technology Stack & Framework Selection

### 2.1 Frontend Architecture (Separated SPA Repository)

- **Core Library & Build Tool:** **Next.js 16** with **TypeScript**
- **State Management:**
  - **Zustand:** Global UI state, authentication session, active chat state.
  - **TanStack Query (React Query v5):** Server state caching, asynchronous data fetching, optimistic UI updates.
- **UI Components & Styling:**
  - **Shadcn UI:** Accessible, re-usable Radix UI primitive components tailored for Vite React setup.
  - **Tailwind CSS:** Utility-first styling with responsive design tokens.
  - **Lucide React:** Iconography.
- **Form Handling & Validation:** **React Hook Form** paired with **Zod** schema validation.
- **Data Visualization:** **Recharts** or **Chart.js** for interactive financial and rental analytics dashboards.
- **Real-Time Engine:** **Socket.io-client** for instant messaging, notifications, and real-time maintenance updates.
- **Testing Suite:** **Vitest**, **React Testing Library**, **MSW (Mock Service Worker)**, and **Playwright** for E2E user-flow testing.

### 2.2 Backend Architecture (Separated Node.js API Service)

- **Runtime & Framework:** Node.js with Express.js (TypeScript)
- **Database:** PostgreSQL (Relational Database)
- **ORM:** Prisma ORM (Type-safe database client and migrations)
- **Caching & Session Storage:** Redis (For OTP caching, token blacklisting, and Socket.io adapter)
- **Authentication & Security:** JWT (JSON Web Tokens) with dual-token rotation (Short-lived Access Token + HTTP-only Refresh Token), bcrypt password hashing, and CORS configuration for SPA client.
- **Real-Time Engine:** Socket.io server with authentication middleware.
- **PDF & Image Generation:** Puppeteer / `pdfkit` / `canvas` for server-side PDF invoice and JPG receipt rendering with digital signature overlays.
- **Messaging Integration:** Integration with WhatsApp Business API / UltraMsg / Green API or Webhooks for OTP dispatch over WhatsApp / IMO.
- **Testing Suite:** **Vitest / Jest**, **Supertest**, and isolated test databases with Docker / **Testcontainers**.

---

## 3. Comprehensive Feature Matrix

### 3.1 Tenant (User) Features

1. **Registration & Profile Management:**
   - Detailed registration fields: Full Name, Phone Number, DOB, Total Family Members.
   - Comprehensive Address Fields: Village/Street, Post Office, District, Police Station (Thana), Division.
   - Identity Verification: Identity Type (`PASSPORT`, `NID`, `BIRTH_CERTIFICATE`) and Identity Number.
2. **OTP Verification:**
   - Free OTP delivery over **WhatsApp** or **IMO** protocol webhooks.
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
   - Instant messaging channel directly connecting Tenant with Property Admin.
   - Automated chatbot helper for quick FAQs (Rent payment instructions, emergency contacts, maintenance rules).

### 3.2 Property Owner (Admin) Features

1. **Dynamic Database Column & Schema Management (Admin Data Control):**
   - Direct capability to append, update, or alter any field/column value across all database tables dynamically via dedicated Admin control routes or JSON/PostgreSQL schema extensions.
   - Built-in dynamic data tables and mutation forms on the Admin frontend to inspect and edit raw column attributes across all system entities (`User`, `Flat`, `Tenancy`, `Invoice`, `BuildingExpense`, `MaintenanceTicket`, `ChatMessage`).
2. **Tenant Control & Approval Center (RBAC):**
   - Review pending tenant registrations, verify ID documents, approve/reject access.
   - Full CRUD operations on tenant records, flat allocations, and tenancy histories.
3. **Financial Management & Profit/Expense Analytics:**
   - **Revenue/Profit Engine:** Revenue is derived purely from Base Flat Rent collections.
   - **Expense Engine:** Track operating costs including utility, electricity, internet, and building maintenance expenses.
   - Calculation: `Net Profit = Total Collected Flat Rent - Property Operational Expenses`.
4. **Graphical Dashboards & Data Export:**
   - Visual charts: Revenue vs. Expense trends (Monthly/Yearly bar & line graphs).
   - Export capabilities: Comprehensive financial statement export in **CSV** and **Excel (.xlsx)** format using `exceljs`.
5. **Maintenance Ticket Resolution Center:**
   - Unified dashboard displaying reporter info, flat number, date, severity, and photo logs.
6. **Invoice & Receipt Generation:**
   - One-click PDF & JPG receipt generation for individual tenant billing cycles.
   - Built-in Admin Digital Signature stamp on all generated invoices.

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
+------------------+     +------------------+      +------------------+
|  PostgreSQL DB   |     |    Redis Cache   |      |  Third-Party     |
| (Prisma Engine)  |     | (OTP/Sessions)   |      | (WhatsApp/IMO)   |
+------------------+     +------------------+      +------------------+
```

---

## 5. Prisma Database Schema (`schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
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

model Tenancy {
  id             String    @id @default(uuid())
  userId         String    @unique
  flatId         String
  user           User      @relation(fields: [userId], references: [id])
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
  sender     User     @relation("SentMessages", fields: [senderId], references: [id])
  receiver   User     @relation("ReceivedMessages", fields: [receiverId], references: [id])
  message    String
  isBot      Boolean  @default(false)
  read       Boolean  @default(false)

  createdAt  DateTime @default(now())
}
```

---

## 6. REST API Endpoint Specification

### 6.1 Auth & Verification

- `POST /api/v1/auth/register` — Register a new tenant with profile details.
- `POST /api/v1/auth/send-otp` — Trigger WhatsApp/IMO OTP code (cached in Redis for 3 min).
- `POST /api/v1/auth/verify-otp` — Verify phone number via OTP.
- `POST /api/v1/auth/login` — Authenticate user and issue JWT Access + Refresh token.
- `POST /api/v1/auth/refresh` — Refresh expired access token.

### 6.2 Dynamic Schema & Table Management (Admin)

- `GET /api/v1/admin/tables` — Fetch database table metadata, dynamic schema definitions, and column schemas.
- `GET /api/v1/admin/tables/:tableName` — Query records and dynamic columns for any table.
- `POST /api/v1/admin/tables/:tableName/columns` — Dynamically add a new column/field definition to a database table.
- `PATCH /api/v1/admin/tables/:tableName/records/:id` — Update or populate any column value for a specific record.

### 6.3 Rent & Financials (User & Admin)

- `GET /api/v1/rent/my-summary` — Get tenant's current & historical rent, tenancy duration, active dues, and advance deposit.
- `POST /api/v1/rent/request-due` — User requests current month's rent deferral (roll-over to next month or deduct from advance).
- `GET /api/v1/admin/analytics` — Admin overview of revenue (flat rent) vs expenses (utility/water/electricity) with date range filters.
- `GET /api/v1/admin/analytics/export?format=csv|xlsx` — Stream CSV/Excel report.

### 6.4 Maintenance & Reports

- `POST /api/v1/tickets` — Submit a new maintenance issue report.
- `GET /api/v1/tickets` — Admin fetches all issue reports with filters.
- `PATCH /api/v1/tickets/:id` — Admin updates ticket status (`IN_PROGRESS`, `RESOLVED`, `REJECTED`).

### 6.5 Invoices & Receipts

- `GET /api/v1/invoices/:id/pdf` — Render & download tenant invoice as PDF.
- `GET /api/v1/invoices/:id/jpg` — Render & download tenant invoice receipt image.

---

## 7. Comprehensive Testing Strategy & Quality Assurance Matrix

### 7.1 Automated Testing Architecture

To guarantee end-to-end reliability, security, and smooth user experience across both frontend and backend from every angle of user (Tenant and Admin):

1. **End-to-End (E2E) Journey Tests (Playwright / Cypress):**
   - **Tenant Angle:** Registration flow with complete address details, WhatsApp/IMO OTP submission, rent deferral selection (Advance deduction vs. roll-over), maintenance photo submission, and live WebSocket chat.
   - **Admin Angle:** Tenant review and approval workflow, graphical dashboard inspection, exporting financial CSV/Excel sheets, generating signed PDF/JPG receipts, and resolving tickets.
2. **Frontend Unit & Integration Tests (Vitest + React Testing Library + MSW):**
   - Form schema validation tests with Zod and React Hook Form.
   - Global Zustand store state mutation tests (auth sessions, dynamic theme, chat status).
   - Mocking backend APIs via MSW to test TanStack Query state caching and UI error states.
3. **Backend API & Business Logic Tests (Vitest / Jest + Supertest):**
   - **RBAC Security:** Ensure unauthorized roles receive `403 Forbidden` on protected admin endpoints.
   - **Rent & Advance Math Engine:** Test calculations when deducting rent from advance balances vs. carrying over unpaid balances to `accumulatedDue`.
   - **PDF/JPG Renderer:** Validate that server-rendered buffers output valid PDF/JPG buffers with signatures without memory leaks.

### 7.2 Manual Testing & QA Matrix

| Category                            | Test Scenario                                                                            | Expected Outcome                                                                                                        |
| :---------------------------------- | :--------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **RBAC Security**                   | Tenant attempts to access `/admin/analytics` directly via client URL or REST request.    | Client redirects to unauthorized view or API responds with HTTP `403 Forbidden`.                                        |
| **Rent Deferral (Advance Deposit)** | Tenant with $500 advance deposit defers a $600 rent bill.                                | $500 deducted from advance balance, remaining $100 appended to `accumulatedDue` for next billing cycle.                 |
| **Real-time Messaging**             | Tenant and Admin message each other simultaneously across different browsers.            | WebSocket delivers messages instantaneously without manual page reload; fallback to long polling if socket disconnects. |
| **Data Export**                     | Admin exports financial statements containing 1,000+ invoice records to Excel (`.xlsx`). | Server streams file cleanly via `exceljs` without memory bottlenecks or corrupted spreadsheet formatting.               |
| **Mobile Responsiveness**           | Tenant accesses dashboard on small screens.                                              | Navigation drawer collapses gracefully and forms adjust to mobile viewport touch targets.                               |

### 7.3 CI/CD Automated Testing Pipeline Workflow (`.github/workflows/test.yml`)

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

### 8.2 Real-Time Messaging & Chatbot Engine

- Socket.io instance authenticates via JWT token handshake.
- Room strategy: `room_user_{tenantId}` and `room_admin_global`.
- Integrated automated bot responds to standard keywords (`/rent`, `/due`, `/contact`, `/rules`) before routing to live Admin agent.

---

## 9. Separated Directory Structure

```
amar-bari/
├── client/                     # Standalone React 19 + Vite Frontend SPA
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/         # Shadcn UI & Custom Components
│   │   ├── hooks/              # Custom Hooks (useSocket, useAuth, useRent)
│   │   ├── pages/              # SPA Route Pages (Tenant & Admin Dashboards)
│   │   ├── routes/             # React Router v7 Configuration & Role Guards
│   │   ├── services/           # Axios Base Client & API Call Modules
│   │   ├── store/              # Zustand Global Stores
│   │   ├── tests/              # Frontend Unit & Vitest Spec Files
│   │   ├── types/              # Shared TypeScript Type Declarations
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
│   │   ├── utils/              # Excel Exporters, Prisma Client Instance
│   │   └── server.ts           # Application Entry Point
│   ├── tests/                  # API Supertest Suites & Integration Specs
│   ├── prisma/
│   │   └── schema.prisma       # Database Schema Definition
│   ├── package.json
│   └── tsconfig.json
│
└── e2e/                        # Playwright / Cypress E2E Cross-Role Test Suite
    ├── tests/
    │   ├── tenant-flow.spec.ts
    │   └── admin-flow.spec.ts
    └── playwright.config.ts
```

---

_Generated by AmarBari System Design Engine._
