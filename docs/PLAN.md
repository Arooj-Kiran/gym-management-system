# Gym Management System — Implementation Plan (Stage 0)

> Status: **APPROVED (2026-10-14).** Decisions D1–D8 approved; change requests C1–C2 incorporated. Stages 1–3 approved; Stage 4 built, exit gate blocked by the local environment (see Section 11).
> Priority order (from docs/RULES.md): security and the biometric authorization rule → correctness → rules → this plan → requirements → speed.

## Contents

0. Approved decisions and change requests
1. Technology stack evaluation and recommendation
2. Architecture and folder structure
3. Data models
4. REST API routes
5. Role-permission matrix
6. Biometric integration design
7. Environment variables and external services
8. Test plan (covers all Section 19 scenarios)
9. Implementation stages (Stage 1 to Stage 8)
10. Risks and dependencies
11. Progress

---

## 0. Approved Decisions and Change Requests

All decisions were approved on 2026-10-14. Any further change to them needs approval (RULES.md §9).

| # | Decision | Status | Approved outcome |
|---|----------|--------|------------------|
| D1 | Tech stack | **Approved** | TypeScript + React + Express + PostgreSQL (Drizzle ORM) |
| D2 | Extra membership status `PENDING` | **Approved** | `PENDING` = assigned but not yet activated. **Never eligible for entry.** |
| D3 | Role-permission matrix | **Approved** | Section 5 as written is binding |
| D4 | Biometric enrollment roles | **Approved** | Admin and Manager only |
| D5 | Gym timezone and currency | **Approved** | `GYM_TIMEZONE=Asia/Karachi`, `CURRENCY_CODE=PKR` |
| D6 | Scope | **Approved** | Single gym, single location |
| D7 | Database | **Approved** | PostgreSQL 17 installed natively on Windows, `psql` on PATH (verified: `psql (PostgreSQL) 17.11`) |
| D8 | Online payments | **Approved** | None for now. Counter payments only (cash, bank transfer, card on a POS terminal, other). |

| # | Change request | Where it is applied |
|---|----------------|---------------------|
| C1 | **Membership activation policy.** A membership may be activated with an outstanding balance (its invoice shows as outstanding or partially paid). A gym setting, **"Require full payment before activation"**, defaults to **OFF** and can only be changed by the Admin. Every change is audit-logged. | §3.3, §3.11, §4.4, §8.2, §9 Stage 5 |
| C2 | **Duplicate phone numbers are a warning, not a block.** Family members may share a phone. Authorized staff see the matching members and can confirm and override, with an audit log. **A duplicate email remains blocked.** | §3.2, §4.3, §8.2, §9 Stage 2 |

**Environment checked on this machine (2026-10-14):**
- Node.js v24.19.0 and npm 11.17.0 are installed.
- PostgreSQL 17.11 is installed (`C:\Program Files\PostgreSQL\17\bin\psql.exe`).
- Docker and MongoDB are not installed, and neither is needed.

---

## 1. Technology Stack Evaluation

### 1.1 What the domain needs

- **Highly relational data.** Members → memberships → invoices → payments → refunds. Members → attendance → access attempts. Trainers → classes → sessions → bookings. Almost every screen joins three or more entities.
- **Money.** Exact amounts, balances and refunds that must never exceed what was paid.
- **Multi-record atomic changes.** A granted check-in writes an access attempt and an attendance record together. A payment updates the invoice status. A cancellation writes a history event and an audit log.
- **Hard integrity rules.** No overlapping memberships, no double bookings, no conflicting trainer appointments, no duplicate members, and append-only history tables.
- **Reporting.** Grouped aggregates by day, month and year, and by status or plan.
- **Security-critical authorization**, where a type or shape mistake could grant entry.

### 1.2 Options compared

| Criterion | JS + Express + MongoDB (suggested) | **TS + Express + PostgreSQL (recommended)** |
|---|---|---|
| Relational joins | `$lookup` pipelines, or denormalization that can go stale | Native joins and foreign keys |
| Transactions | Need a replica set, even locally (extra setup on Windows) | ACID by default on a single local server |
| Integrity constraints | Unique and partial indexes only. No foreign keys, CHECK constraints or range-overlap rules. | Foreign keys, CHECK, partial unique indexes, and **exclusion constraints** that block overlapping date or time ranges at the database level |
| Money | Decimal128 or integer cents, enforced only by the app | Integer minor units, with `CHECK (amount > 0)` in the database |
| Append-only history | App discipline only | A database trigger rejects UPDATE and DELETE on audit, access-attempt and membership-event tables |
| Reporting | Aggregation pipelines | SQL `GROUP BY` and `date_trunc`, which are easy to verify against raw rows (test scenario 16) |
| Fuzzy member search | Text indexes (word-based) | `pg_trgm` trigram index (partial names and phone numbers) |
| Type safety | None. A typo like `stauts` passes silently. | Compile-time types, and shared Zod schemas between frontend and backend |
| Team familiarity / docs | Very common | Very common. PostgreSQL is the most widely used open-source relational database. |

### 1.3 Recommendation

**Use TypeScript + React + Node.js/Express + PostgreSQL.** The frontend (React), API style (REST) and server framework (Express) stay exactly as the requirements suggest. Only two things change:

1. **PostgreSQL instead of MongoDB.** This is the strong technical reason. The most important rules in this project (never overlap memberships, never double-book, never delete history, never refund more than paid, write the check-in and the attempt atomically) can be enforced **by the database itself**, not only by application code. That gives defence in depth for the rules RULES.md ranks highest.
2. **TypeScript instead of JavaScript.** The access decision, the permission matrix and the money calculations get compile-time checking. The same validation schemas are shared by client and server.

**Decision (D1): approved on 2026-10-14.** MongoDB is not used.

### 1.4 Chosen libraries (major dependencies, for approval)

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js 24 LTS | Already installed |
| Monorepo | npm workspaces | No extra tool needed |
| Backend | Express 5, TypeScript, `tsx` (dev runner) | Requirement; mature |
| ORM / migrations | **Drizzle ORM** + drizzle-kit, `pg` driver | Typed SQL. Partial indexes and CHECK constraints are declared in the schema. Migrations are plain SQL files, so exclusion constraints and triggers can be added. |
| Validation | Zod (in a shared package) | One schema serves frontend forms, the backend and the TypeScript types |
| Password hashing | `argon2` (argon2id) | RULES.md §6. Has prebuilt Windows binaries. |
| Security middleware | `helmet`, `express-rate-limit`, `cookie-parser` | Security headers and rate limiting |
| Logging | `pino` + `pino-http` with redaction | Structured logs. Secrets, cookies and passwords are never logged. |
| Uploads | `multer` + `file-type` (magic-byte check) | Profile photos and exercise images |
| Dates | `date-fns` + `@date-fns/tz` | Calendar-day comparisons in the gym's timezone |
| Phone numbers | `libphonenumber-js` | Normalize to E.164 format so duplicate detection works |
| Scheduler | `node-cron` + PostgreSQL advisory lock | Daily expiry and reminder jobs that never run twice |
| Frontend | React 19, Vite, React Router, TanStack Query | Standard modern SPA |
| Forms | React Hook Form + Zod resolver | Shares the server's schemas |
| Styling | Tailwind CSS with CSS-variable design tokens | Requirement |
| Accessible UI primitives | Radix UI (Dialog, Dropdown, Popover, Select, Tabs, Tooltip) | Keyboard and screen-reader support |
| Icons / toasts / charts | `lucide-react`, `sonner`, `recharts` | Consistent icon set, toasts, React charts |
| Testing | Vitest, Supertest, Testing Library, Playwright, `@axe-core/playwright` | API, component, E2E, responsive and accessibility tests |
| Email (Stage 7) | `nodemailer` (SMTP) | REQUIRES CONFIGURATION |
| SMS / WhatsApp (Stage 7) | Twilio REST API via `fetch` (no SDK) | REQUIRES CONFIGURATION |

---

## 2. Architecture and Folder Structure

### 2.1 System overview

```
 ┌────────────────────────────┐        HTTPS, same origin, httpOnly session cookie + CSRF header
 │  Web app (React SPA)       │ ───────────────────────────────────────────────┐
 │  • Staff dashboard         │                                                │
 │  • Member portal           │ ◄── Server-Sent Events (kiosk access results) ─┤
 │  • Kiosk / access screen   │                                                ▼
 │  • SIMULATED scanner panel │                                 ┌──────────────────────────────┐
 └────────────────────────────┘                                 │  API server (Express, TS)    │
                                                                │  routes → controllers →      │
 ┌────────────────────────────┐  HTTPS, outbound only,          │  services → Drizzle → PG     │
 │ Biometric agent (front-desk│  device API key, idempotent     │  • AccessDecisionService     │
 │ PC, Node service)          │  eventId                        │    (single source of truth)  │
 │ • ScannerAdapter interface │ ──────────────────────────────► │  • Jobs (cron + adv. lock)   │
 │ • SimulatedAdapter         │ ◄── decision (GRANTED / DENIED) │  • Notification channels     │
 │ • Vendor adapter (later)   │                                 └──────────────┬───────────────┘
 │ • Denial outbox (no        │                                                │
 │   eligibility cache)       │                                 ┌──────────────▼───────────────┐
 └─────────────┬──────────────┘                                 │ PostgreSQL 17                │
               │ vendor SDK / LAN                               │ constraints, triggers, pg_trgm│
       ┌───────▼────────┐                                       └──────────────────────────────┘
       │ Fingerprint    │   device-side matching; returns only a template reference ID
       │ terminal       │
       └────────────────┘
```

Key principles:

- **One access-decision function.** The simulated panel, the real agent and manual staff verification all call the same `AccessDecisionService.decide()` on the server. No other code path can produce `GRANTED`.
- **Fail closed everywhere.** The server defaults to `DENIED`. `GRANTED` is returned only after the transaction that records the attempt and the attendance has committed. Clients (agent and kiosk) treat anything other than `HTTP 200` plus a schema-valid `decision === "GRANTED"` as denied, including timeouts, network errors and malformed responses.
- **No eligibility cache** in the browser, kiosk, agent or scanner. Each scan reads current database rows.
- **Same origin.** In production Express serves the built SPA. In development the Vite dev server proxies `/api` to Express. Either way cookies stay first-party, and CORS is restricted to `WEB_ORIGIN`.
- **Authorization in two layers.** Route middleware checks role permissions (`requirePermission('memberships:cancel')`). Services apply object-level scoping: members see only their own rows, trainers only their assigned members.
- **Layering** (RULES.md §11): `routes` (HTTP wiring) → `controller` (parse, validate, respond) → `service` (business rules, transactions, audit) → `db/schema` (models). Validation schemas live in `packages/shared`.

### 2.2 Folder structure

```
Gym-Management-System/
├─ apps/
│  ├─ server/
│  │  ├─ src/
│  │  │  ├─ app.ts                     # builds the Express app (used by server.ts and tests)
│  │  │  ├─ server.ts                  # starts listening, graceful shutdown, starts jobs
│  │  │  ├─ config/env.ts              # Zod-validated env; refuses unsafe combinations
│  │  │  ├─ db/
│  │  │  │  ├─ client.ts               # pg pool + drizzle instance
│  │  │  │  ├─ schema/                 # one file per domain (users.ts, members.ts, …)
│  │  │  │  ├─ migrations/             # generated + hand-written SQL (constraints, triggers)
│  │  │  │  └─ seed/                   # base.ts (admin, settings), demo.ts (fictional data)
│  │  │  ├─ middleware/                # requestId, session, csrf, requirePermission,
│  │  │  │                             # deviceAuth, rateLimits, validate, errorHandler
│  │  │  ├─ lib/                       # errors, logger, money, dates (gym TZ), codes,
│  │  │  │                             # pagination, csv, audit, transactions
│  │  │  ├─ modules/
│  │  │  │  ├─ auth/                   # each module contains:
│  │  │  │  ├─ staff/                  #   <name>.routes.ts
│  │  │  │  ├─ members/                #   <name>.controller.ts
│  │  │  │  ├─ plans/                  #   <name>.service.ts
│  │  │  │  ├─ memberships/            #   <name>.policy.ts (object scoping, when needed)
│  │  │  │  ├─ access/                 # AccessDecisionService, eligibility.ts (pure), SSE
│  │  │  │  ├─ attendance/
│  │  │  │  ├─ biometrics/             # consent, enrollments, simulator fixtures
│  │  │  │  ├─ devices/
│  │  │  │  ├─ billing/                # invoices, payments, refunds, receipts
│  │  │  │  ├─ trainers/  schedules/  classes/  appointments/
│  │  │  │  ├─ workouts/  equipment/  notifications/
│  │  │  │  ├─ dashboard/  reports/  audit/  settings/
│  │  │  │  └─ portal/                 # /me/* routes for members (scoped by session)
│  │  │  ├─ jobs/                      # scheduler.ts + one file per job
│  │  │  └─ integrations/              # storage/, email/, sms/, whatsapp/ adapters
│  │  └─ test/
│  │     ├─ setup/                     # test-DB guard, migrate, truncate, factories, login helpers
│  │     ├─ unit/                      # pure logic (eligibility, money, dates, invoice status)
│  │     └─ integration/               # Supertest per module + permission-matrix test
│  ├─ web/
│  │  ├─ src/
│  │  │  ├─ main.tsx, App.tsx
│  │  │  ├─ routes/                    # router, RequireAuth, RequirePermission, role home redirect
│  │  │  ├─ api/                       # fetch client (credentials, CSRF header), query keys
│  │  │  ├─ components/
│  │  │  │  ├─ ui/                     # Button, Input, Select, FormField, Dialog, ConfirmDialog,
│  │  │  │  │                          # DataTable, Pagination, Badge, StatusBadge, Card, StatCard,
│  │  │  │  │                          # EmptyState, ErrorState, Skeleton, Tabs, Drawer,
│  │  │  │  │                          # SearchInput, DateRangeFilter, MoneyText
│  │  │  │  ├─ layout/                 # AppShell, Sidebar, Topbar, PortalShell, KioskShell,
│  │  │  │  │                          # DemoDataBanner, SimulatedBadge
│  │  │  │  └─ charts/                 # RevenueChart, AttendanceChart (Recharts wrappers)
│  │  │  ├─ features/<module>/         # pages/, components/, hooks/ per module
│  │  │  ├─ portal/                    # member-facing pages
│  │  │  ├─ kiosk/                     # AccessResultScreen, SimulatedScannerPanel
│  │  │  ├─ lib/                       # formatMoney, formatDate, can(permission)
│  │  │  └─ styles/                    # tokens.css (light + dark), index.css
│  │  ├─ test/                         # component tests
│  │  └─ e2e/                          # Playwright: flows, responsive, a11y
│  └─ biometric-agent/
│     ├─ src/
│     │  ├─ index.ts, config.ts
│     │  ├─ adapters/                  # ScannerAdapter.ts (interface), SimulatedAdapter.ts
│     │  ├─ backendClient.ts           # signed, timeout-bounded, fail-closed requests
│     │  └─ outbox.ts                  # denial-only offline log (JSON lines), uploaded later
│     └─ test/
├─ packages/
│  └─ shared/src/
│     ├─ roles.ts, permissions.ts      # THE role-permission matrix (single source)
│     ├─ enums.ts                      # statuses, reason codes, payment methods
│     └─ schemas/                      # Zod schemas per module
├─ docs/                               # requirements.md, RULES.md, PLAN.md, BIOMETRICS.md,
│                                      # SECURITY.md, NOTIFICATIONS.md, API.md
├─ .env.example   .gitignore   package.json (workspaces)   tsconfig.base.json
├─ eslint.config.js   .prettierrc
└─ README.md
```

### 2.3 Conventions

- **Files:** `kebab-case`. **Components:** `PascalCase`. **DB tables and columns:** `snake_case`. **JSON:** `camelCase`. **Enums:** `UPPER_SNAKE`.
- **Primary keys:** UUID (`gen_random_uuid()`). **Human-readable codes** come from PostgreSQL sequences, so they are race-free: `GM-000042` (member), `INV-000123`, `RCP-000045`, `RFD-000007`, `EQ-000017`.
- **Money:** integer minor units (`amount_minor BIGINT`), one currency from `CURRENCY_CODE`.
- **Dates:** membership `start_date` and `end_date` are `DATE` values, inclusive, interpreted in `GYM_TIMEZONE`. Timestamps are `timestamptz`.
- **API errors:** `{ error: { code, message, details? } }`, where `details` only holds field validation errors. Stack traces are never returned.
- **List endpoints:** `?page=1&pageSize=20&sort=field&order=asc|desc&q=…`. Responses look like `{ data, page, pageSize, total }`.

---

## 3. Data Models

Every table has `id UUID PK`, `created_at` and `updated_at`, unless stated otherwise. "Append-only" means a database trigger rejects `UPDATE` and `DELETE`. Required PostgreSQL extensions: `pgcrypto`, `pg_trgm`, `btree_gist` (needed for exclusion constraints).

### 3.1 Identity and access

**users**: login accounts for every role.

| Field | Type / rule |
|---|---|
| email | `citext`, required, unique, valid email |
| password_hash | argon2id. Never selected by default and never returned by the API. |
| role | enum `ADMIN, MANAGER, RECEPTIONIST, TRAINER, MEMBER` |
| first_name, last_name | 1–80 chars |
| phone | E.164, optional |
| is_active | bool, default true. Deactivation revokes all sessions immediately. |
| must_change_password | bool (set for temporary or seeded passwords) |
| failed_login_count, locked_until | lockout after repeated failures |
| last_login_at | timestamptz |
| is_demo | bool (fictional demo data) |

Indexes: unique `(email)`, and `(role, is_active)`.

**user_sessions**: server-side sessions, revocable.

| Field | Type / rule |
|---|---|
| token_hash | SHA-256 of a 32-byte random token. Unique. The raw token exists only in the httpOnly cookie. |
| user_id | FK users |
| csrf_token | random; must be sent as the `X-CSRF-Token` header on unsafe methods |
| expires_at, last_seen_at | absolute timeout plus idle timeout |
| ip, user_agent | for audit |
| revoked_at | set on logout, deactivation or password change |

Indexes: unique `(token_hash)`, `(user_id)` where `revoked_at IS NULL`, `(expires_at)`.

**staff_profiles**: `user_id` (FK, unique), `job_title`, `hire_date`, `notes`. One row per staff user (any role except MEMBER).

### 3.2 Members

**members**

| Field | Type / rule |
|---|---|
| member_code | `GM-000001` from a sequence. Unique and immutable. |
| user_id | FK users, nullable, unique (portal login is optional) |
| first_name, last_name | required, 1–80 chars |
| email | `citext`, optional, valid email |
| phone_e164 | required, normalized E.164 |
| profile_photo_key | storage key, nullable. Served only through an authorized route. |
| emergency_contact_name / _phone / _relation | optional (the phone is normalized) |
| registration_date | DATE, default today (gym TZ), cannot be in the future |
| notes | ≤ 2000 chars |
| account_status | enum `ACTIVE, INACTIVE`. INACTIVE is never eligible for entry. |
| access_blocked | bool + `access_block_reason`, `access_blocked_at`, `access_blocked_by`. A manual restriction. |
| archived_at, archived_by | soft delete. History is kept. |
| is_demo | bool |
| created_by | FK users |

Duplicate handling (C2):

- **Email is a hard block.** Partial unique index `(lower(email)) WHERE archived_at IS NULL AND email IS NOT NULL`. A duplicate returns `409 DUPLICATE_EMAIL` with the existing member.
- **Phone is a warning.** There is **no** unique constraint on `phone_e164`, because family members may share a number.
  - On create, or on an update that changes the phone, if a non-archived member already has the same `phone_e164`, the API returns `409 DUPLICATE_PHONE_WARNING`. The response lists the matching members (code, name, and a same-name flag).
  - Staff with `members:create` / `members:update` can resubmit with `confirmDuplicatePhone: true` and a required `duplicatePhoneReason` (for example "Shared family number").
  - The save and an audit entry `MEMBER_DUPLICATE_PHONE_CONFIRMED` are written in one transaction. The entry holds the actor, the matched member IDs and the reason.
  - Matches with the **same name and same phone** get a stronger warning ("this may be the same person"), but can still be overridden the same way.
- A pre-check endpoint returns both results before submit, so the form can show "this member already exists" or "this phone is used by …" inline.

Indexes: unique `(member_code)`; **non-unique** `(phone_e164) WHERE archived_at IS NULL` (duplicate lookup); GIN trigram on `first_name || ' ' || last_name`, `email` and `phone_e164` (search); `(registration_date)`; `(account_status)`.

### 3.3 Membership plans and memberships

**membership_plans**

| Field | Type / rule |
|---|---|
| name | unique (case-insensitive), 2–80 chars |
| plan_type | enum `MONTHLY, QUARTERLY, SIX_MONTH, ANNUAL, CUSTOM` |
| duration_value, duration_unit | int > 0. Unit is `DAY` or `MONTH`. Fixed for non-custom types: 1, 3, 6 or 12 months. |
| price_minor | BIGINT, ≥ 0 |
| description | ≤ 2000 chars |
| benefits | `text[]`, each ≤ 120 chars |
| allow_partial_payment | bool |
| access_days | `smallint[]` (ISO weekday 1–7), nullable = every day |
| access_start_time, access_end_time | TIME, nullable = all hours. Both set or both null. |
| is_active | bool. Archived plans cannot be assigned. Existing memberships keep their snapshot. |

CHECK constraints: the duration matches `plan_type`; `price_minor >= 0`.

**memberships**: one row per membership period (a renewal creates a new row).

| Field | Type / rule |
|---|---|
| member_id | FK members |
| plan_id | FK membership_plans |
| plan_name_snapshot, price_minor_snapshot, access-rule snapshot | copied when assigned, so later plan edits do not rewrite history |
| start_date, end_date | DATE, inclusive. `end_date >= start_date`. Computed from the plan duration on the server. |
| status | enum `PENDING, ACTIVE, SUSPENDED, CANCELLED, EXPIRED` (PENDING needs approval, D2) |
| activated_at, activated_by | |
| suspended_at, suspension_reason | |
| cancelled_at, cancelled_by, cancellation_reason | |
| total_suspended_days | int ≥ 0 (used when reactivating with an extension) |
| renewed_from_id | FK memberships, nullable (renewal chain) |
| created_by | FK users |
| version | int, for optimistic locking |

Integrity:
- **Exclusion constraint:** no two memberships of the same member with overlapping `daterange(start_date, end_date, '[]')` while status is `PENDING`, `ACTIVE` or `SUSPENDED`.
- Status transitions are allowed only as follows (enforced in the service, and tested):
  `PENDING → ACTIVE | CANCELLED`; `ACTIVE → SUSPENDED | CANCELLED | EXPIRED`; `SUSPENDED → ACTIVE | CANCELLED`. `CANCELLED` and `EXPIRED` are terminal (continue with a renewal, which creates a new row).
- A renewal starts the day after the latest current `end_date`, or today if that date has already passed.
- **Activation policy (C1).** Activation (`PENDING → ACTIVE`) checks the gym setting `require_full_payment_before_activation`:
  - **OFF (default):** activation is allowed with an outstanding balance. The membership's invoice stays `PENDING`, `PARTIALLY_PAID` or `OVERDUE`, and the member page, membership card and portal show the outstanding amount.
  - **ON:** activation is rejected with `409 PAYMENT_REQUIRED` (including the outstanding amount) unless the linked invoice is `PAID`.
  - Renewals follow the same policy. With the setting ON, an unpaid renewal stays `PENDING` until it is paid in full and activated.
  - Entry eligibility (§6.3) still depends **only** on membership status, dates and access restrictions. An outstanding balance never grants or blocks entry by itself.
  - The policy check needs invoices, so it is built in **Stage 5**. In Stages 3–4 activation behaves exactly like the default (OFF).

Indexes: `(member_id, start_date DESC)`, `(status, end_date)` (expiry jobs and reports), `(plan_id)`.

**membership_events**: status and change history. **Append-only.**
Fields: `membership_id`, `member_id`, `event_type` (`CREATED, ACTIVATED, RENEWED, EXTENDED, SUSPENDED, REACTIVATED, CANCELLED, EXPIRED`), `from_status`, `to_status`, `old_values jsonb`, `new_values jsonb` (dates and plan), `reason`, `actor_user_id` (null when the system job made the change), `created_at`.
Indexes: `(membership_id, created_at)`, `(member_id, created_at)`, `(event_type, created_at)`.

### 3.4 Billing

**invoices**: what a member owes.

| Field | Type / rule |
|---|---|
| invoice_number | `INV-000001`, unique |
| member_id | FK |
| membership_id | FK, nullable (manual charges are allowed) |
| description | required |
| amount_due_minor | BIGINT > 0 |
| due_date | DATE |
| status | enum `PENDING, PARTIALLY_PAID, PAID, OVERDUE, REFUNDED, VOID`. Always recalculated by the server inside the payment or refund transaction. |
| voided_at, voided_by, void_reason | voiding is the only way to "remove" an invoice |

Status rule, where `net_paid = Σ completed payments − Σ refunds`:
`VOID` if voided → else `PAID` if `net_paid ≥ amount_due` → else `REFUNDED` if there were payments and `net_paid = 0` → else `PARTIALLY_PAID` if `net_paid > 0` → else `OVERDUE` if `due_date < today` → else `PENDING`.

Indexes: unique `(invoice_number)`, `(member_id, due_date)`, `(status, due_date)`.

**payments**: never deleted.

| Field | Type / rule |
|---|---|
| receipt_number | `RCP-000001`, unique |
| invoice_id, member_id | FKs |
| amount_minor | BIGINT > 0, ≤ outstanding balance (checked under a row lock). Partial amounts only if the plan allows them. |
| method | enum `CASH, BANK_TRANSFER, CARD, OTHER, ONLINE` |
| reference | required for BANK_TRANSFER and CARD; ≤ 120 chars |
| status | enum `COMPLETED, PENDING_CONFIRMATION, FAILED`. Counter methods are COMPLETED when recorded. ONLINE stays PENDING_CONFIRMATION until a verified provider webhook arrives (not built until a provider is configured). |
| provider, provider_payment_id | nullable. Unique `(provider, provider_payment_id)`. |
| received_at | timestamptz, not in the future |
| recorded_by | FK users |
| notes | |

Indexes: `(member_id, received_at DESC)`, `(received_at)` (reports), `(invoice_id)`.

**refunds**: `refund_number` (`RFD-000001`, unique), `payment_id` FK, `amount_minor` > 0, `reason` (required), `method`, `refunded_at`, `recorded_by`. Rule: Σ refunds ≤ payment amount, checked while the payment row is locked with `FOR UPDATE`. Index `(payment_id)`, `(refunded_at)`.

### 3.5 Attendance and access control

**access_devices**

| Field | Type / rule |
|---|---|
| name, location | required |
| device_type | enum `SIMULATED, REAL`. **The source of every attempt is derived from this field on the server, never from the client.** |
| vendor, model, serial_number | nullable (REAL only) |
| api_key_hash | SHA-256 of the device secret. The secret is shown once at creation or rotation. |
| status | enum `ACTIVE, DISABLED`. Scans from a disabled device are denied. |
| last_seen_at, last_health | `OK` or `ERROR` + `last_error_code` (from heartbeats) |

**access_attempts**: every scan, granted or denied. **Append-only.**

| Field | Type / rule |
|---|---|
| occurred_at | timestamptz (device time, sanity-checked; server `received_at` is also stored) |
| device_id | FK, nullable (manual verification has no device) |
| source | enum `SIMULATED, REAL, MANUAL` |
| event_id | idempotency key from the device |
| member_id, membership_id | nullable (unknown fingerprint has neither) |
| result | enum `GRANTED, DENIED` |
| reason | enum (see 6.4): `GRANTED, MEMBER_NOT_RECOGNIZED, MEMBER_INACTIVE, ACCESS_BLOCKED, NO_MEMBERSHIP, MEMBERSHIP_NOT_ACTIVATED, MEMBERSHIP_NOT_STARTED, MEMBERSHIP_EXPIRED, MEMBERSHIP_CANCELLED, MEMBERSHIP_SUSPENDED, OUTSIDE_ACCESS_HOURS, SCANNER_UNAVAILABLE, AUTHORIZATION_UNAVAILABLE, DEVICE_NOT_AUTHORIZED` |
| is_duplicate | bool. A granted scan inside the duplicate window. It re-uses the existing attendance record. |
| attendance_id | FK, nullable |
| verified_by_user_id | for MANUAL attempts |
| uploaded_from_outbox | bool (denials the agent logged while the backend was unreachable) |

Indexes: unique `(device_id, event_id)` where `event_id IS NOT NULL`; `(occurred_at DESC)`; `(member_id, occurred_at DESC)`; `(result, reason, occurred_at)`.

**attendance_records**: one row per granted entry. Never deleted (voided instead).

| Field | Type / rule |
|---|---|
| member_id, membership_id | FKs (the membership that authorized the entry) |
| check_in_at | timestamptz |
| check_out_at | nullable, must be > check_in_at. **Never used in eligibility decisions.** |
| source | `SIMULATED, REAL, MANUAL` |
| access_attempt_id | FK, unique |
| status | `VALID, VOIDED` |
| created_by | staff user for MANUAL entries |

Indexes: `(member_id, check_in_at DESC)`, `(check_in_at)`.

**attendance_corrections**: **append-only** audit of corrections. Fields: `attendance_id`, `field` (`CHECK_IN_AT, CHECK_OUT_AT, STATUS`), `old_value`, `new_value`, `reason` (required), `corrected_by`, `created_at`.

### 3.6 Biometrics (privacy-minimal)

**biometric_consents**: `member_id`, `consent_version` (for example `2026-10-v1`), `consent_text_sha256`, `given_at`, `recorded_by`, `withdrawn_at`, `withdrawn_recorded_by`. Enrollment is impossible without an un-withdrawn consent. Index `(member_id)`.

**biometric_enrollments**

| Field | Type / rule |
|---|---|
| member_id | FK |
| device_id | FK access_devices (the terminal or group that holds the template) |
| provider | `SIMULATED` or a vendor code (`ZKTECO`, `SUPREMA`, …) |
| template_ref | **only** the device-side user or template ID (for example `SIM-0003` or device PIN `1042`). No image or template. Never logged. Masked in API responses. |
| consent_id | FK biometric_consents |
| status | `ACTIVE, REVOKED, DELETED` |
| enrolled_by, enrolled_at, revoked_by, revoked_at, revoke_reason | |
| deleted_at | `template_ref` is set to NULL once the device confirms deletion |

Integrity: partial unique `(device_id, template_ref) WHERE status = 'ACTIVE'`; a CHECK that `SIMULATED` refs start with `SIM-`; the service rejects a `SIM-` ref on a REAL device and the reverse.

> No `template_ciphertext` column is planned. It will be added (AES-256-GCM, never selected or returned) **only** if you choose a host-matching USB reader and the templates cannot stay on the agent PC. That would be a schema change needing approval.

### 3.7 Staff, trainers and schedules

- **trainer_profiles**: `user_id` (FK, unique, role must be TRAINER), `bio`, `specializations text[]`, `certifications text[]`, `is_bookable` bool.
- **trainer_assignments**: `trainer_id`, `member_id`, `start_date`, `end_date` nullable, `assigned_by`, `ended_by`, `notes`. Partial unique `(trainer_id, member_id) WHERE end_date IS NULL`.
- **trainer_availability**: weekly slots. `trainer_id`, `weekday` 1–7, `start_time`, `end_time` (`end > start`), `effective_from`, `effective_to`.
- **trainer_time_off**: `trainer_id`, `starts_at`, `ends_at`, `reason`, `status` (`ACTIVE, CANCELLED`).
- **staff_shifts**: `user_id` (any staff), `starts_at`, `ends_at`, `role_note`, `status` (`SCHEDULED, CANCELLED`). Exclusion: no overlapping SCHEDULED shifts per user.

### 3.8 Workouts

- **exercises**: `name` (unique, case-insensitive), `description`, `muscle_group` (enum: `CHEST, BACK, SHOULDERS, ARMS, LEGS, GLUTES, CORE, FULL_BODY, CARDIO`), `difficulty` (`BEGINNER, INTERMEDIATE, ADVANCED`), `instructions`, `equipment_needed`, `image_key`, `is_active`, `created_by`. Indexes: trigram on name, `(muscle_group, difficulty)`.
- **workout_plans**: `name`, `description`, `goal`, `difficulty`, `owner_trainer_id`, `is_template`, `status` (`ACTIVE, ARCHIVED`).
- **workout_plan_items**: `plan_id`, `exercise_id`, `day_number` 1–7, `position`, `sets` 1–20, `reps` 1–100 nullable, `duration_seconds` nullable, `rest_seconds` 0–600, `load_note`, `notes`. CHECK: reps or duration is set. Unique `(plan_id, day_number, position)`.
- **workout_assignments**: `plan_id`, `member_id`, `trainer_id`, `start_date`, `end_date`, `status` (`ACTIVE, COMPLETED, CANCELLED`), `trainer_notes`. The trainer must be assigned to the member (checked in the service).
- **workout_logs** (completion records): `assignment_id`, `member_id`, `plan_item_id` nullable, `performed_on` DATE, `completed` bool, `actual_sets / reps / load / duration`, `notes`, `logged_by`. Index `(member_id, performed_on DESC)`.
- **progress_entries**: `member_id`, `recorded_on`, `weight_kg` (20–400), `body_fat_pct` (2–70), `measurements jsonb` (validated keys: chest, waist, hips, arm, thigh in cm), `notes`, `recorded_by`. Index `(member_id, recorded_on DESC)`.

### 3.9 Classes and appointments

- **fitness_classes** (class templates): `name` (unique), `description`, `default_duration_minutes` 15–240, `default_capacity` 1–200, `default_trainer_id`, `is_active`.
- **class_sessions**: `class_id`, `trainer_id`, `starts_at`, `ends_at`, `capacity` 1–200, `room`, `status` (`SCHEDULED, CANCELLED, COMPLETED`), `cancel_reason`. **Exclusion:** no overlapping SCHEDULED sessions for the same trainer, or for the same room. Index `(starts_at)`, `(trainer_id, starts_at)`.
- **class_bookings**: `session_id`, `member_id`, `status` (`BOOKED, WAITLISTED, CANCELLED, ATTENDED, NO_SHOW`), `waitlist_position`, `booked_at`, `cancelled_at`, `booked_by`. Partial unique `(session_id, member_id) WHERE status IN ('BOOKED','WAITLISTED')`, which blocks duplicate bookings. Capacity is checked while the session row is locked with `FOR UPDATE`. When a booking is cancelled, the first waitlisted member is promoted in the same transaction. The member must have an eligible membership on the session date.
- **appointments** (personal training): `trainer_id`, `member_id`, `starts_at`, `ends_at`, `status` (`BOOKED, CANCELLED, COMPLETED, NO_SHOW`), `notes`, `created_by`. **Exclusion:** no overlap per trainer and none per member while BOOKED. Conflicts with class sessions and time off are checked in the service under a per-trainer advisory lock. The slot must sit inside the trainer's availability.

### 3.10 Equipment

- **equipment**: `asset_tag` (`EQ-000001`, unique), `name`, `category` (enum: `CARDIO, STRENGTH_MACHINE, FREE_WEIGHTS, FUNCTIONAL, ACCESSORY, OTHER`), `brand`, `model`, `serial_number` (unique when present), `location`, `purchase_date`, `purchase_cost_minor` ≥ 0, `condition` (`EXCELLENT, GOOD, FAIR, POOR`), `status` (`IN_SERVICE, OUT_OF_SERVICE, RETIRED`), `out_of_service_reason`, `maintenance_interval_days`, `next_maintenance_date`, `notes`. Index `(status)`, `(next_maintenance_date)`.
- **maintenance_records**: `equipment_id`, `type` (`PREVENTIVE, REPAIR, INSPECTION`), `performed_on`, `performed_by_name`, `cost_minor`, `description`, `repair_notes`, `condition_after`, `next_maintenance_date`, `recorded_by`. Recording one updates the equipment's condition and next date in the same transaction.

### 3.11 Notifications, audit and settings

- **notifications**: `recipient_user_id`, `type` (`MEMBERSHIP_EXPIRING, MEMBERSHIP_EXPIRED, MEMBERSHIP_CANCELLED, MEMBERSHIP_SUSPENDED, PAYMENT_DUE, PAYMENT_OVERDUE, RENEWAL_SUCCESS, CLASS_REMINDER, APPOINTMENT_REMINDER, EQUIPMENT_MAINTENANCE_DUE, BIOMETRIC_RETENTION_DUE`), `title`, `body`, `entity_type`, `entity_id`, `read_at`, `dedupe_key` (unique, so daily jobs never duplicate a reminder). Index `(recipient_user_id, read_at, created_at DESC)`.
- **notification_deliveries**: `notification_id`, `channel` (`EMAIL, SMS, WHATSAPP`), `status` (`NOT_CONFIGURED, SENT, FAILED`), `provider_message_id`, `error_code`, `attempted_at`.
- **audit_logs**: **append-only.** `actor_user_id`, `actor_role`, `action` (for example `MEMBERSHIP_CANCELLED`, `PAYMENT_RECORDED`, `REFUND_ISSUED`, `ATTENDANCE_CORRECTED`, `ROLE_CHANGED`, `STAFF_DEACTIVATED`, `BIOMETRIC_ENROLLED`, `BIOMETRIC_DELETED`, `MANUAL_CHECK_IN`, `DEVICE_KEY_ROTATED`, `SETTINGS_CHANGED`, `MEMBER_DUPLICATE_PHONE_CONFIRMED`, `LOGIN_FAILED`), `entity_type`, `entity_id`, `before jsonb`, `after jsonb` (secrets stripped), `reason`, `ip`, `user_agent`, `request_id`, `created_at`. Index `(entity_type, entity_id)`, `(actor_user_id, created_at)`, `(action, created_at)`.
- **gym_settings** (one row): `gym_name`, `expiry_reminder_days` (default 7), `payment_due_reminder_days` (3), `invoice_due_days` (default 0 = due on start date), `biometric_retention_days` (30), `class_booking_cutoff_minutes` (60).
  - Also `require_full_payment_before_activation` (bool, **default false**, C1). The column is added in Stage 5 together with billing.
  - Only `settings:manage` (Admin) can change any setting.
  - Each change writes a `SETTINGS_CHANGED` audit entry with old and new values, the actor, and an optional reason.
  - Timezone (`Asia/Karachi`) and currency (`PKR`) come from env.

### 3.12 Relationship summary

```
users 1─1 staff_profiles            users 1─1 trainer_profiles         users 1─0..1 members
members 1─* memberships *─1 membership_plans      memberships 1─* membership_events
members 1─* invoices 1─* payments 1─* refunds     memberships 1─* invoices
members 1─* attendance_records 1─1 access_attempts *─1 access_devices
members 1─* biometric_consents 1─* biometric_enrollments *─1 access_devices
trainer_profiles 1─* trainer_assignments *─1 members
trainer_profiles 1─* trainer_availability / trainer_time_off / class_sessions / appointments
fitness_classes 1─* class_sessions 1─* class_bookings *─1 members
workout_plans 1─* workout_plan_items *─1 exercises
workout_plans 1─* workout_assignments *─1 members   workout_assignments 1─* workout_logs
equipment 1─* maintenance_records    users 1─* notifications 1─* notification_deliveries
```

All foreign keys use `ON DELETE RESTRICT`, because history-bearing rows are never hard-deleted.

---

## 4. REST API Routes

Base path: `/api/v1`. All routes need a valid session unless they are marked **public** or **device**. All unsafe methods need the `X-CSRF-Token` header. The **Permission** column refers to the keys in Section 5. "Stage" is the stage that builds the route.

### 4.1 Health and auth (Stage 1)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/health` | public | Liveness |
| GET | `/health/ready` | public | Checks the database connection |
| POST | `/auth/login` | public | Rate-limited per IP and per account. Generic error message. |
| POST | `/auth/logout` | any | Revokes the session |
| GET | `/auth/me` | any | User, role, permission list, csrfToken, mustChangePassword |
| POST | `/auth/change-password` | any | Revokes the user's other sessions |

### 4.2 Staff accounts (Stage 1) and settings and audit (Stage 1)

| Method | Path | Permission |
|---|---|---|
| GET | `/staff` | `staff:read` |
| POST | `/staff` | `staff:manage` |
| GET | `/staff/:id` | `staff:read` |
| PATCH | `/staff/:id` | `staff:manage` |
| PATCH | `/staff/:id/role` | `staff:assign-role` |
| POST | `/staff/:id/activate` · `/staff/:id/deactivate` | `staff:manage` |
| POST | `/staff/:id/reset-password` | `staff:manage` (sets a temporary password, forces a change) |
| GET | `/audit-logs` | `audit:read` |
| GET · PATCH | `/settings` | `settings:read` · `settings:manage` (Admin only; every change audit-logged, including the C1 activation policy) |

### 4.3 Members (Stage 2)

| Method | Path | Permission |
|---|---|---|
| GET | `/members` (`q, accountStatus, membershipStatus, paymentStatus, trainerId, registeredFrom, registeredTo, sort, order, page, pageSize`) | `members:read` (trainers get only assigned members, with a reduced field set) |
| GET | `/members/check-duplicate?email=&phone=&excludeId=` | `members:create` or `members:update` → `{ emailConflict, phoneMatches[] }` |
| POST | `/members` | `members:create`. `409 DUPLICATE_EMAIL` (hard block). `409 DUPLICATE_PHONE_WARNING` unless the body includes `confirmDuplicatePhone: true` + `duplicatePhoneReason` (audit-logged, C2). |
| GET · PATCH | `/members/:id` | `members:read` · `members:update` (same email and phone rules when the phone changes) |
| POST | `/members/:id/archive` · `/restore` | `members:archive` |
| POST · GET | `/members/:id/photo` | `members:update` · `members:read` |
| POST | `/members/:id/portal-account` | `members:update` (creates a MEMBER login with a temporary password) |
| POST | `/members/:id/access-block` · `/access-unblock` | `access:restrict` |
| GET | `/members/:id/memberships` · `/membership-events` | `memberships:read` (Stage 3) |
| GET | `/members/:id/attendance` · `/access-attempts` | `attendance:read` (Stage 4) |
| GET | `/members/:id/invoices` · `/payments` | `payments:read` (Stage 5) |

### 4.4 Membership plans (Stage 2) and memberships (Stage 3)

| Method | Path | Permission |
|---|---|---|
| GET | `/membership-plans` | `plans:read` |
| POST | `/membership-plans` | `plans:manage` |
| GET · PATCH | `/membership-plans/:id` | `plans:read` · `plans:manage` |
| POST | `/membership-plans/:id/archive` · `/unarchive` | `plans:manage` |
| GET | `/memberships` (`status, planId, expiringWithinDays, from, to, page…`) | `memberships:read` |
| POST | `/memberships` (`memberId, planId, startDate`) → `PENDING` + invoice | `memberships:assign` |
| GET | `/memberships/:id` · `/memberships/:id/events` | `memberships:read` |
| POST | `/memberships/:id/activate` | `memberships:activate`. From Stage 5: `409 PAYMENT_REQUIRED` when "require full payment before activation" is ON and the invoice is not PAID (C1). |
| POST | `/memberships/:id/renew` (`planId?`) | `memberships:renew` (same activation policy) |
| POST | `/memberships/:id/extend` (`days, reason`) | `memberships:change-status` |
| POST | `/memberships/:id/suspend` (`reason`) | `memberships:change-status` |
| POST | `/memberships/:id/reactivate` (`extendBySuspendedDays, reason`) | `memberships:change-status` |
| POST | `/memberships/:id/cancel` (`reason`) | `memberships:change-status` |

### 4.5 Access control, attendance, devices and biometrics (Stage 4)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/access/scan` | **device** (API key) | `{ eventId, matchResult: MATCH \| NO_MATCH \| DEVICE_ERROR, templateRef?, errorCode?, occurredAt }` → decision. Rate-limited per device. |
| POST | `/access/offline-denials` | **device** | Upload of the agent's denial outbox. Always stored as DENIED / AUTHORIZATION_UNAVAILABLE. |
| POST | `/devices/heartbeat` | **device** | Scanner health (OK / ERROR) |
| POST | `/access/simulate` | `access:simulate` | **SIMULATED only.** Returns 404 unless `BIOMETRIC_SIMULATOR_ENABLED=true`. `{ deviceId, templateRef? , scenario? }` where scenario ∈ `NO_MATCH, SCANNER_UNAVAILABLE, AUTHORIZATION_UNAVAILABLE`. |
| GET | `/access/simulator/fixtures` | `access:simulate` | Fake `SIM-` IDs with labels (active, expired, cancelled, …) |
| GET | `/access/stream?deviceId=` | `access:monitor` | Server-Sent Events: live decisions for the kiosk screen |
| GET | `/access/attempts` (`result, reason, source, deviceId, memberId, from, to`) | `access:read-log` | |
| POST | `/attendance/manual-check-in` (`memberId, reason`) | `attendance:manual-check-in` | Same decision service, source MANUAL, audit-logged |
| GET | `/attendance` (`date, from, to, memberId, q, source, page…`) · `/attendance/today` | `attendance:read` | |
| POST | `/attendance/:id/check-out` | `attendance:check-out` | |
| POST | `/attendance/:id/corrections` (`checkInAt?, checkOutAt?, status?, reason`) | `attendance:correct` | Audit-logged |
| GET | `/attendance/:id/corrections` | `attendance:read` | |
| GET · POST | `/devices` | `devices:manage` | POST returns the secret once |
| PATCH | `/devices/:id` | `devices:manage` | |
| POST | `/devices/:id/rotate-key` · `/disable` · `/enable` | `devices:manage` | |
| GET | `/members/:id/biometric` | `biometrics:read-status` | Consent and enrollment status. `template_ref` is masked. |
| POST | `/members/:id/biometric/consent` · `/consent/withdraw` | `biometrics:manage` | Withdrawing consent revokes the enrollments |
| POST | `/members/:id/biometric/enrollments` (`deviceId, templateRef?`) | `biometrics:manage` | A simulated device auto-generates a `SIM-` ref |
| POST | `/biometric/enrollments/:id/revoke` (`reason`) | `biometrics:manage` | Queues device deletion. Audit-logged. |
| POST | `/biometric/enrollments/:id/confirm-deletion` | **device** | The agent confirms the template was removed from the device |

### 4.6 Billing (Stage 5)

| Method | Path | Permission |
|---|---|---|
| GET | `/invoices` (`status, memberId, from, to, q, page…`) | `payments:read` |
| POST | `/invoices` (manual charge) | `payments:record` |
| GET | `/invoices/:id` | `payments:read` |
| POST | `/invoices/:id/void` (`reason`) | `payments:void` |
| GET | `/payments` (`method, status, memberId, from, to, q, page…`) | `payments:read` |
| POST | `/payments` (`invoiceId, amountMinor, method, reference?, receivedAt, notes?`) | `payments:record` |
| GET | `/payments/:id` · `/payments/:id/receipt` | `payments:read` |
| POST | `/payments/:id/refunds` (`amountMinor, reason, method`) | `payments:refund` |
| GET | `/refunds` | `payments:read` |

Online checkout and the provider webhook (`POST /webhooks/payments/:provider`, with signature verification) are **not built** until a provider is chosen (REQUIRES CONFIGURATION).

### 4.7 Trainers, schedules, classes and appointments (Stage 6)

| Method | Path | Permission |
|---|---|---|
| GET | `/trainers` · `/trainers/:id` | `trainers:read` |
| PATCH | `/trainers/:id` | `trainers:manage` (or the trainer editing their own bio and specializations) |
| GET · PUT | `/trainers/:id/availability` | `trainers:read` · `trainers:manage-availability` (own or Admin/Manager) |
| POST | `/trainers/:id/time-off` · `/time-off/:id/cancel` | `trainers:manage-availability` |
| GET | `/trainers/:id/schedule?from=&to=` | `trainers:read` |
| GET | `/trainers/:id/available-slots?date=&durationMinutes=` | `appointments:read` |
| GET | `/trainers/:id/members` | `trainer-assignments:read` (a trainer may read only their own list) |
| POST | `/trainer-assignments` · `/trainer-assignments/:id/end` | `trainer-assignments:manage` |
| GET · POST | `/shifts` · `/shifts/:id` (PATCH) · `/shifts/:id/cancel` | `schedules:read` · `schedules:manage` |
| GET · POST | `/classes` · PATCH `/classes/:id` · POST `/classes/:id/archive` | `classes:read` · `classes:manage` |
| GET | `/class-sessions` (`from, to, trainerId, classId`) · `/class-sessions/:id` | `classes:read` |
| POST | `/class-sessions` (single, or a weekly recurrence with an end date) | `classes:manage` |
| PATCH · POST | `/class-sessions/:id` · `/class-sessions/:id/cancel` | `classes:manage` |
| GET | `/class-sessions/:id/bookings` | `bookings:read` |
| POST | `/class-sessions/:id/bookings` (`memberId`) | `bookings:manage` |
| POST | `/bookings/:id/cancel` | `bookings:manage` |
| POST | `/bookings/:id/attendance` (`ATTENDED \| NO_SHOW`) | `classes:mark-attendance` (Trainer: own sessions) |
| GET · POST | `/appointments` | `appointments:read` · `appointments:manage` |
| GET · PATCH | `/appointments/:id` | `appointments:read` · `appointments:manage` |
| POST | `/appointments/:id/cancel` · `/complete` · `/no-show` | `appointments:manage` |

### 4.8 Workouts, equipment and notifications (Stage 7)

| Method | Path | Permission |
|---|---|---|
| GET · POST | `/exercises` | `exercises:read` · `exercises:manage` |
| GET · PATCH | `/exercises/:id` | `exercises:read` · `exercises:manage` |
| POST | `/exercises/:id/image` · `/exercises/:id/archive` | `exercises:manage` |
| GET · POST | `/workout-plans` | `workouts:read` · `workouts:manage` |
| GET · PATCH | `/workout-plans/:id` | `workouts:read` · `workouts:manage` |
| PUT | `/workout-plans/:id/items` | `workouts:manage` |
| POST | `/workout-plans/:id/duplicate` · `/archive` | `workouts:manage` |
| GET · POST | `/workout-assignments` | `workouts:read` · `workouts:assign` (Trainer: assigned members only) |
| PATCH | `/workout-assignments/:id` | `workouts:assign` |
| GET · POST | `/workout-logs` | `workouts:read` · `workouts:log` |
| GET · POST | `/members/:id/progress` | `progress:read` · `progress:record` |
| GET · POST | `/equipment` | `equipment:read` · `equipment:manage` |
| GET · PATCH | `/equipment/:id` | `equipment:read` · `equipment:manage` |
| POST | `/equipment/:id/status` (`status, reason`) | `equipment:manage` |
| GET · POST | `/equipment/:id/maintenance` | `equipment:read` · `equipment:manage` |
| GET | `/equipment/maintenance-due?days=` | `equipment:read` |
| GET | `/notifications` · `/notifications/unread-count` | any (own only) |
| POST | `/notifications/:id/read` · `/notifications/read-all` | any (own only) |
| GET | `/notifications/channels` | `settings:read` (shows which channels are configured) |

### 4.9 Dashboard (grows in Stages 2–5, completed in Stage 8) and reports (Stage 8)

| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard/summary?from=&to=` | `dashboard:read`. The response depends on the role: revenue fields only with `reports:financial`. |
| GET | `/dashboard/charts/revenue?from=&to=&interval=day\|month` | `reports:financial` |
| GET | `/dashboard/charts/attendance?from=&to=&interval=` | `reports:operational` |
| GET | `/dashboard/activity` | `dashboard:read` |
| GET | `/reports/:type?from=&to=&format=json\|csv` | Per type, see below |

Report types: `registrations`, `membership-status`, `renewals`, `attendance`, `denied-access`, `class-attendance`, `equipment-maintenance` → `reports:operational`. `payments`, `outstanding-balances`, `revenue`, `trainer-performance` → `reports:financial`.

### 4.10 Member portal, `/me/*` (each module's portal routes are built in that module's stage)

The member ID always comes from the session, never from the URL. A member calling any staff route gets `403`.

| Method | Path | Stage |
|---|---|---|
| GET · PATCH | `/me/profile` (PATCH: emergency contact and photo only) | 2 |
| GET | `/me/membership` (current + renewal info) · `/me/memberships` | 3 |
| GET | `/me/attendance` | 4 |
| GET | `/me/invoices` · `/me/payments` · `/me/payments/:id/receipt` | 5 |
| GET | `/me/trainers` · `/me/schedule` · `/me/class-sessions` · `/me/appointments` | 6 |
| POST | `/me/bookings` · `/me/bookings/:id/cancel` · `/me/appointments/:id/cancel` | 6 |
| GET · POST | `/me/workouts` · `/me/workout-logs` · `/me/progress` | 7 |

---

## 5. Role-Permission Matrix

The matrix lives in `packages/shared/src/permissions.ts`. The backend enforces it on every route. The frontend reads it only to hide controls. An automated table-driven test (Section 8) calls every protected route as every role and asserts allow or deny exactly as shown here.

Legend: **Yes** = allowed · **Own** = only the user's own records · **Assigned** = only members assigned to that trainer (trainer-safe fields) · **—** = denied (403).

| Permission | Admin | Manager | Receptionist | Trainer | Member |
|---|---|---|---|---|---|
| **Staff and system** |
| `staff:read` | Yes | Yes | — | — | — |
| `staff:manage` (create, edit, activate/deactivate, reset password) | Yes | — | — | — | — |
| `staff:assign-role` | Yes | — | — | — | — |
| `settings:read` / `settings:manage` | Yes / Yes | Yes / — | — | — | — |
| `audit:read` | Yes | — | — | — | — |
| `devices:manage` | Yes | — | — | — | — |
| **Members** |
| `members:read` | Yes | Yes | Yes | Assigned | Own (via `/me`) |
| `members:create` / `members:update` | Yes | Yes | Yes | — | — (Own: emergency contact and photo only) |
| `members:archive` | Yes | Yes | — | — | — |
| `access:restrict` (block / unblock entry) | Yes | Yes | — | — | — |
| **Plans and memberships** |
| `plans:read` | Yes | Yes | Yes | — | Yes (active plans) |
| `plans:manage` | Yes | — | — | — | — |
| `memberships:read` | Yes | Yes | Yes | Assigned (status and dates only) | Own |
| `memberships:assign` (create PENDING) | Yes | Yes | Yes | — | — |
| `memberships:activate` | Yes | Yes | Yes | — | — |
| `memberships:renew` | Yes | Yes | Yes | — | — |
| `memberships:change-status` (cancel, suspend, reactivate, extend) | Yes | Yes | — | — | — |
| **Access control and attendance** |
| `access:simulate` (simulated scanner, dev only) | Yes | Yes | Yes | — | — |
| `access:monitor` (kiosk result stream) | Yes | Yes | Yes | — | — |
| `access:read-log` (granted and denied attempts) | Yes | Yes | Yes | — | — |
| `attendance:read` | Yes | Yes | Yes | Assigned | Own |
| `attendance:manual-check-in` (still backend-authorized) | Yes | Yes | Yes | — | — |
| `attendance:check-out` | Yes | Yes | Yes | — | — |
| `attendance:correct` | Yes | Yes | — | — | — |
| `biometrics:read-status` | Yes | Yes | Yes | — | Own |
| `biometrics:manage` (consent, enroll, revoke/delete) | Yes | Yes | — | — | — |
| **Billing** |
| `payments:read` | Yes | Yes | Yes | — | Own |
| `payments:record` (counter payments, manual invoice) | Yes | Yes | Yes | — | — |
| `payments:refund` | Yes | Yes | — | — | — |
| `payments:void` (void invoice) | Yes | Yes | — | — | — |
| **Trainers and schedules** |
| `trainers:read` | Yes | Yes | Yes | Yes | Yes (public profile fields) |
| `trainers:manage` | Yes | Yes | — | Own (bio, specializations) | — |
| `trainers:manage-availability` | Yes | Yes | — | Own | — |
| `trainer-assignments:read` | Yes | Yes | Yes | Own | Own (my trainers) |
| `trainer-assignments:manage` | Yes | Yes | — | — | — |
| `schedules:read` (staff shifts) | Yes | Yes | Own | Own | — |
| `schedules:manage` | Yes | Yes | — | — | — |
| **Classes and appointments** |
| `classes:read` | Yes | Yes | Yes | Yes | Yes |
| `classes:manage` (templates, sessions, cancel) | Yes | Yes | — | — | — |
| `classes:mark-attendance` | Yes | Yes | Yes | Own sessions | — |
| `bookings:read` | Yes | Yes | Yes | Own sessions | Own |
| `bookings:manage` (book or cancel for a member) | Yes | Yes | Yes | — | Own (book or cancel eligible classes) |
| `appointments:read` | Yes | Yes | Yes | Own | Own |
| `appointments:manage` | Yes | Yes | Yes | Own (assigned members) | Own (cancel only) |
| **Workouts and progress** |
| `exercises:read` | Yes | Yes | — | Yes | Via assigned plans |
| `exercises:manage` | Yes | Yes | — | Yes | — |
| `workouts:read` | Yes | Yes | — | Own plans + Assigned | Own |
| `workouts:manage` (create or edit plans) | Yes | Yes | — | Own plans | — |
| `workouts:assign` | Yes | Yes | — | Assigned | — |
| `workouts:log` (completion records) | Yes | Yes | — | Assigned | Own |
| `progress:read` / `progress:record` | Yes / Yes | Yes / Yes | — | Assigned / Assigned | Own / Own |
| **Equipment** |
| `equipment:read` | Yes | Yes | Yes | Yes | — |
| `equipment:manage` (records, status, maintenance) | Yes | Yes | — | — | — |
| **Dashboard and reports** |
| `dashboard:read` | Yes (full) | Yes (full) | Yes (operational, no revenue) | Yes (own schedule and members) | — (portal home instead) |
| `reports:operational` (+ CSV) | Yes | Yes | Attendance and denied access only | — | — |
| `reports:financial` (+ CSV) | Yes | Yes | — | — | — |
| **Notifications** | Own | Own | Own | Own | Own |

Notes:
- **Trainer-safe member fields:** name, photo, member code, membership status and dates, trainer notes, workouts and progress. **Not** included: email, phone, emergency contact, payments, biometric status.
- **Test scenario 11** ("unauthorized staff cannot change membership status"): Receptionist and Trainer get `403` on cancel, suspend, reactivate and extend. Trainer also gets `403` on activate and renew. Members get `403` on every membership mutation.
- Managers cannot create staff accounts or change roles. Only the Admin can, which prevents privilege escalation. Changing this is a matrix change (RULES.md §9).
- **C1:** the "require full payment before activation" setting falls under `settings:manage`, so it is **Admin only**. Managers can read it (`settings:read`) but not change it.
- **C2:** confirming a duplicate-phone warning needs no new permission. Any role that may create or update the member (Admin, Manager, Receptionist) can confirm it, with a required reason and an audit entry. The approved matrix is unchanged.

---

## 6. Biometric Integration Design

> **Status until real hardware is connected and tested: SIMULATED.** Nothing in the UI, code or docs will call a simulated scan "biometric verification".

### 6.1 Hardware options

A browser cannot talk to fingerprint hardware directly. Vendor SDKs are native libraries, mostly for Windows (C, C# or Java). So every real option needs a **local service** on the front-desk PC. That service is `apps/biometric-agent`.

| Option | Example devices (verify current models and SDK licensing with the vendor before buying) | Where matching happens | Integration | Assessment |
|---|---|---|---|---|
| **A. Networked access terminal (recommended)** | ZKTeco access terminals (for example the K40 or MB-series); Suprema BioEntry / BioStation; Anviz | **On the device.** Templates never leave the terminal. | ZKTeco Standalone/Pull SDK (Windows) or its push protocol; Suprema G-SDK (gRPC) or the BioStar 2 API | Best privacy (RULES.md §5). Needs a LAN connection. **Critical:** these devices open the door on a match by default. They must be set to **identify-only / no relay**. The relay or turnstile is triggered only by the agent, after the backend returns `GRANTED`. |
| B. USB desktop reader | HID DigitalPersona U.are.U 4500 / 5300; SecuGen Hamster Pro 20; Suprema BioMini | **On the host PC**, through the SDK's 1:N identify | DigitalPersona SDK, SecuGen FDx SDK Pro, BioMini SDK | Cheaper, desk-only. Templates must be stored on the agent PC, encrypted (AES-256-GCM, key protected by Windows DPAPI). Raw images are discarded immediately. More privacy work. |
| C. WebAuthn / Windows Hello / phone fingerprint | n/a | Per user account on one device | Browser API | **Not suitable.** It proves possession of a personal device and cannot identify hundreds of members at a shared entrance. |

**Questions to check with the vendor before buying** (they go into `docs/BIOMETRICS.md`):
- Supported OS and SDK language
- License cost
- Whether automatic door opening can be disabled
- How the device reports an identified user ID (event latency, push or pull)
- Remote template deletion API
- Whether raw images are ever exported
- Clock sync behaviour
- Tamper and offline behaviour

**Bridging the SDK to Node:** a small vendor-specific sidecar (for example a .NET console process speaking JSON over stdio), or `koffi` FFI. This is decided in the hardware stage after a device is chosen. It is **outside Stages 1–8** unless hardware is available.

### 6.2 Agent design (local service)

```
ScannerAdapter (interface)
  start(onEvent) / stop() / health() / enroll(memberLabel) → templateRef / deleteTemplate(templateRef)
  onEvent: { eventId, occurredAt, matchResult: MATCH | NO_MATCH | DEVICE_ERROR, templateRef?, errorCode? }

SimulatedAdapter   — Stage 4. Driven by CLI or test input. Uses fake SIM- IDs only.
<Vendor>Adapter    — added later when hardware is chosen (needs approval).
```

- **Outbound only.** The agent calls the backend over HTTPS with `Authorization: Device <deviceId>.<secret>`. It opens no inbound ports.
- **Idempotency.** Each scanner event gets a UUID `eventId`. Retries reuse it, and the database's unique `(device_id, event_id)` turns repeats into the same decision.
- **Strict response handling.** Timeout is `AGENT_REQUEST_TIMEOUT_MS` (default 3000). The agent opens the relay only if it gets `HTTP 200` and a Zod-valid body with `decision === "GRANTED"` and an `attemptId`. Everything else is DENIED.
- **No eligibility cache.** The agent stores nothing about memberships. When the backend is unreachable it writes **denial facts only** (time, eventId, NO decision data) to a local JSON-lines outbox, shows "Access Denied — cannot verify membership", and uploads the outbox later to `/access/offline-denials`.
- **Heartbeat** every 30 s reports scanner health. If a scan arrives while the scanner reports `DEVICE_ERROR`, the attempt is logged as `SCANNER_UNAVAILABLE`.

### 6.3 Access decision flow (server: `AccessDecisionService.decide`)

All of the following runs inside one database transaction. The default result is `DENIED / AUTHORIZATION_UNAVAILABLE`. Any thrown error, timeout (statement timeout `ACCESS_DB_TIMEOUT_MS`) or failed commit leaves the default in place.

1. Authenticate the device (API key hash, status `ACTIVE`). If that fails → `DEVICE_NOT_AUTHORIZED` (logged, no member).
2. If `eventId` was already seen for this device → return the stored decision (idempotent replay).
3. `DEVICE_ERROR` → `SCANNER_UNAVAILABLE`.
4. `NO_MATCH`, an unknown `templateRef`, or an enrollment that is not `ACTIVE` → `MEMBER_NOT_RECOGNIZED`. The kiosk shows **"Member Not Recognized"**.
5. Lock the member row (`SELECT … FOR UPDATE`) and the member's memberships (`FOR SHARE`). This serializes scans of the same member, and makes a cancellation committed before the scan always visible to it.
6. Member is archived or `INACTIVE` → `MEMBER_INACTIVE`. `access_blocked` → `ACCESS_BLOCKED`.
7. Evaluate memberships using **today in `GYM_TIMEZONE`** (pure function `eligibility.ts`, unit-tested):
   - An `ACTIVE` membership with `start_date ≤ today ≤ end_date` exists → continue to step 8.
   - Otherwise, report the most relevant membership: `CANCELLED` → `MEMBERSHIP_CANCELLED`; `SUSPENDED` → `MEMBERSHIP_SUSPENDED`; `EXPIRED`, **or `ACTIVE` with `end_date < today`** (so we never rely on the nightly job having run) → `MEMBERSHIP_EXPIRED`; `PENDING` → `MEMBERSHIP_NOT_ACTIVATED`; `ACTIVE` with `start_date > today` → `MEMBERSHIP_NOT_STARTED`; none → `NO_MEMBERSHIP`.
8. Plan access days and hours (from the membership snapshot) → `OUTSIDE_ACCESS_HOURS` if not allowed now.
9. Eligible. If a granted attendance for this member exists within `ACCESS_DUPLICATE_SCAN_WINDOW_SECONDS` (default 60), log the attempt as `GRANTED` with `is_duplicate = true`, linked to the existing attendance, and **do not create a new attendance row**. Eligibility is still re-checked in steps 5–8 first, so a cancellation inside the window still denies.
10. Otherwise insert `attendance_records` and `access_attempts (GRANTED)`, then **commit**. Only after the commit succeeds does the response say `GRANTED`.
11. Publish the decision to the kiosk SSE stream for that device. A failure here does not change the decision.

Check-out is never read by this flow. Manual check-in (`attendance:manual-check-in`) calls the same function with `source = MANUAL`, `verified_by_user_id` set, a required reason, and an audit-log entry.

**Response contract:**
`{ decision, reason, message, source, attemptId, duplicate, member?: { firstName, memberCode, photoUrl }, membership?: { planName, endDate } }`
On denials the member block contains only the first name. Balances and other sensitive details are never shown at the entrance.

### 6.4 Reason codes and kiosk messages

| Reason | Kiosk screen |
|---|---|
| `GRANTED` | **Access Granted.** Welcome, {firstName}. Valid until {endDate}. |
| `MEMBERSHIP_CANCELLED` | **Access Denied.** Membership cancelled. Please see reception. |
| `MEMBERSHIP_EXPIRED` | **Access Denied.** Membership expired on {endDate}. |
| `MEMBERSHIP_SUSPENDED` | **Access Denied.** Membership suspended. |
| `MEMBERSHIP_NOT_ACTIVATED` / `MEMBERSHIP_NOT_STARTED` / `NO_MEMBERSHIP` | **Access Denied.** No active membership for today. |
| `MEMBER_INACTIVE` / `ACCESS_BLOCKED` | **Access Denied.** Please see reception. |
| `OUTSIDE_ACCESS_HOURS` | **Access Denied.** Your plan does not include entry at this time. |
| `MEMBER_NOT_RECOGNIZED` | **Member Not Recognized.** Please try again or see reception. |
| `SCANNER_UNAVAILABLE` | **Access Denied.** Scanner unavailable. Please see reception. |
| `AUTHORIZATION_UNAVAILABLE` / network failure / timeout | **Access Denied.** Membership could not be verified. Please see reception. |
| `DEVICE_NOT_AUTHORIZED` | **Access Denied.** Device not authorized. |

The kiosk resets to "Place your thumb on the scanner" after 5 s. Every screen driven by a SIMULATED device shows a persistent amber **"SIMULATED SCANNER — not real biometric verification"** banner.

### 6.5 Simulated scanner

- Enabled only when `BIOMETRIC_SIMULATOR_ENABLED=true`. The server **refuses to start** if that flag is set together with `NODE_ENV=production`. When disabled, all simulator routes return 404 and the panel is not rendered.
- A **Simulated Scanner panel** (staff UI, `access:simulate`) and a SimulatedAdapter for the agent CLI. Both go through the same decision service as a real device.
- The demo seed creates a SIMULATED device and fictional members, each enrolled with fake IDs:

| Scenario | Fake ID / input | Expected |
|---|---|---|
| Active member | `SIM-0001` | GRANTED |
| Expired member | `SIM-0002` | DENIED · MEMBERSHIP_EXPIRED |
| Cancelled member | `SIM-0003` | DENIED · MEMBERSHIP_CANCELLED |
| Suspended member | `SIM-0004` | DENIED · MEMBERSHIP_SUSPENDED |
| Unknown fingerprint | scenario `NO_MATCH` (or an unenrolled `SIM-9999`) | DENIED · MEMBER_NOT_RECOGNIZED |
| Scanner unavailable | scenario `SCANNER_UNAVAILABLE` | DENIED · SCANNER_UNAVAILABLE |
| Backend authorization unavailable | scenario `AUTHORIZATION_UNAVAILABLE`: the server forces the eligibility query to throw (simulator only). The kiosk also handles a real network failure. | DENIED · AUTHORIZATION_UNAVAILABLE |

- The panel lets staff pick any enrolled `SIM-` ID. So the "cancel, then scan the same thumb" demo works live: scan `SIM-0001` → granted, cancel that membership, scan `SIM-0001` again → denied.
- The attempt `source` is `SIMULATED` because the device type is `SIMULATED`. A client cannot claim `REAL`.

### 6.6 Privacy safeguards

1. **No raw fingerprint images** anywhere: server, agent, logs or tests.
2. **Device-side matching preferred** (option A). The server stores only `template_ref`, a device user ID that is useless without the physical terminal.
3. **`template_ref` is treated as sensitive.** It is redacted in logs (pino redact paths), masked in API responses (`SIM-••01`), and never put in CSV exports.
4. **Consent first.** A versioned consent record (text hash, timestamp, the staff member who recorded it) is required before enrollment. Withdrawing consent revokes all enrollments.
5. **Deletion on request.** Revoke → the agent deletes the template from the device → the device confirms → the enrollment becomes `DELETED` and `template_ref` is erased. Each step is audit-logged.
6. **Retention.** A daily job flags enrollments of members who have been archived, or have had no active membership for `biometric_retention_days`. It notifies Admins and Managers, who confirm the deletion.
7. **Restricted administration.** Only Admin and Manager hold `biometrics:manage`. Device keys are stored as hashes and are rotatable.
8. **Alternative for non-consenting members:** staff manual verification. It goes through the same backend check and is audit-logged.
9. Documented in `docs/BIOMETRICS.md`: data inventory, consent text template, retention and deletion procedure, hardware setup checklist. Plus a note that local biometric-privacy law (for example GDPR Art. 9 or national equivalents) should be reviewed by the gym's legal adviser.

---

## 7. Environment Variables and External Services

All variables are validated at startup by `config/env.ts`, which uses Zod. Missing or invalid values stop the server with a clear message that never prints the value. `.env.example` holds placeholders only, and `.env` is git-ignored.

### 7.1 Server (`apps/server`)

| Variable | Example placeholder | Required | Purpose |
|---|---|---|---|
| `NODE_ENV` | `development` | yes | `development` / `test` / `production` |
| `PORT` | `4000` | yes | API port |
| `WEB_ORIGIN` | `http://localhost:5173` | yes | Allowed CORS origin and CSRF origin check |
| `TRUST_PROXY` | `false` | no | Set when running behind a reverse proxy (correct client IPs for rate limits) |
| `DATABASE_URL` | `postgres://gym_app:CHANGE_ME@localhost:5432/gym_dev` | yes | Development / production database |
| `TEST_DATABASE_URL` | `postgres://gym_app:CHANGE_ME@localhost:5432/gym_test` | tests | **The test runner refuses to start unless the database name ends in `_test` and differs from `DATABASE_URL`.** |
| `COOKIE_SECURE` | `false` (dev) / `true` (prod) | yes | Secure flag on the session cookie. Forced `true` in production. |
| `SESSION_TTL_HOURS` | `12` | no | Absolute session lifetime |
| `SESSION_IDLE_MINUTES` | `60` | no | Idle timeout |
| `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | `5` / `15` | no | Login throttling |
| `ACCOUNT_LOCKOUT_THRESHOLD` / `ACCOUNT_LOCKOUT_MINUTES` | `10` / `15` | no | Per-account lockout |
| `GYM_TIMEZONE` | `Asia/Karachi` | yes | Calendar-day validity checks (D5) |
| `CURRENCY_CODE` | `PKR` | yes | ISO 4217 currency code (D5). Stored in minor units (paisa). The UI shows whole rupees by default. |
| `ACCESS_DUPLICATE_SCAN_WINDOW_SECONDS` | `60` | no | Duplicate-scan window |
| `ACCESS_DB_TIMEOUT_MS` | `2000` | no | Statement timeout for access decisions (fail closed) |
| `ACCESS_SCAN_RATE_LIMIT_PER_MINUTE` | `60` | no | Per-device scan throttle |
| `BIOMETRIC_SIMULATOR_ENABLED` | `true` (dev) | no | Simulated scanner. **Rejected when `NODE_ENV=production`.** |
| `UPLOAD_DIR` / `MAX_UPLOAD_MB` | `./uploads` / `2` | no | Local image storage (outside the web root, served through authorized routes) |
| `LOG_LEVEL` | `info` | no | pino log level |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | `admin@example.test` / `CHANGE_ME_STRONG` | seed only | First admin. Must change password at first login. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | placeholders | no (Stage 7) | Email. REQUIRES CONFIGURATION. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_WHATSAPP_FROM` | placeholders | no (Stage 7) | SMS / WhatsApp. REQUIRES CONFIGURATION. |

Online-payment variables (for example a provider secret key and webhook secret) are added **only** when a provider is approved (D8).

### 7.2 Web (`apps/web`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | API base URL (same origin through the Vite proxy in dev) |
| `VITE_DEV_API_PROXY_TARGET` | `http://localhost:4000` | Dev proxy target |

No secrets ever go into `VITE_*` variables, because they are bundled into public JavaScript.

### 7.3 Biometric agent (`apps/biometric-agent`)

| Variable | Example | Purpose |
|---|---|---|
| `AGENT_BACKEND_URL` | `http://localhost:4000/api/v1` | Backend URL (HTTPS in production) |
| `AGENT_DEVICE_ID` / `AGENT_DEVICE_KEY` | from the Devices screen | Device credentials. The key is a secret. |
| `AGENT_ADAPTER` | `simulated` | Adapter to load |
| `AGENT_REQUEST_TIMEOUT_MS` | `3000` | Fail-closed timeout |
| `AGENT_OUTBOX_PATH` | `./data/outbox.jsonl` | Denial-only offline log |
| `AGENT_HEARTBEAT_SECONDS` | `30` | Health report interval |

### 7.4 External services

| Service | Needed for | Status |
|---|---|---|
| **PostgreSQL 17** (native Windows installer, or a hosted Postgres such as Neon / Supabase / RDS) | Everything. Two databases: `gym_dev` and `gym_test`. | **Required.** Installed: PostgreSQL 17.11, native Windows (D7). The databases and app role are created in Stage 1. |
| SMTP email provider (any: Gmail Workspace SMTP, SendGrid, Mailgun, Amazon SES…) | Email notifications, member invites | Optional. REQUIRES CONFIGURATION. |
| Twilio (SMS + WhatsApp), or Meta WhatsApp Cloud API | SMS / WhatsApp reminders | Optional. REQUIRES CONFIGURATION. WhatsApp also needs Meta business verification and approved templates. |
| Online payment provider (Stripe, or a provider available in your country) | Online payments | Not planned until chosen (D8) |
| Fingerprint terminal + vendor SDK | Real biometric check-in | Optional hardware. SIMULATED until connected and tested. |
| Object storage (S3-compatible) | Photos in production, multi-server setups | Optional. Local disk is used by default. |

---

## 8. Test Plan

### 8.1 Test layers and tooling

| Layer | Tool | Scope | Database |
|---|---|---|---|
| Unit | Vitest | Pure logic: `eligibility.ts`, invoice-status calculation, money, gym-timezone dates, duration math, permission matrix, CSV escaping | none |
| API integration | Vitest + Supertest against `createApp()` | Every route: validation, authorization, transactions, constraints, audit rows | `gym_test` (migrated once per run, tables truncated between test files) |
| Agent | Vitest | SimulatedAdapter, fail-closed client (timeouts, 5xx, malformed body), outbox | mock HTTP server |
| Component | Vitest + Testing Library | Forms, ConfirmDialog, DataTable states, kiosk result screens, SIMULATED banner | mocked API |
| End-to-end | Playwright | Real browser flows, responsive layouts, keyboard navigation, axe accessibility checks | `gym_test` + seeded fixtures |

**Safety guard:** `test/setup/guard.ts` aborts if `TEST_DATABASE_URL` is missing, its database name does not end in `_test`, or it equals `DATABASE_URL`. Tests never touch development or production data. Factories build fictional data with fixed dates (fake timers) so date logic is deterministic.

Commands (wired in Stage 1): `npm test` runs everything except E2E; `npm run test:e2e` runs Playwright; `npm run test:all` runs both.

### 8.2 Coverage of Section 19 scenarios

| # | Scenario | Automated tests | Type | Stage |
|---|---|---|---|---|
| 1 | Register a new member | Create a member → 201 with a `GM-` code. **Duplicate email → 409 `DUPLICATE_EMAIL`; override not possible (C2).** **Duplicate phone → 409 `DUPLICATE_PHONE_WARNING` listing the matches. Resubmitting with confirmation + reason → 201 and one `MEMBER_DUPLICATE_PHONE_CONFIRMED` audit row. Confirmation without a reason → 400. A same-name + same-phone match is flagged. A phone change on update gets the same warning. A Trainer or Member cannot confirm (403).** Validation errors → 400 with field details. An archived member's email can be re-used. Search, sort, filter and pagination return the expected rows. E2E: the receptionist registers a member through the form. | API, E2E | 2 |
| 2 | Create and assign a membership | Admin creates each plan type. Duration and price are validated. Assigning creates a `PENDING` membership with server-computed dates and price snapshot, a `CREATED` event and an invoice. An overlapping assignment is rejected by the exclusion constraint. An archived plan cannot be assigned. | API, E2E | 3 (invoice part: 5) |
| 3 | Activate and renew a membership | `PENDING → ACTIVE` writes an `ACTIVATED` event. **Activation policy (C1, Stage 5): setting OFF → activation with an unpaid or partially paid invoice succeeds and the outstanding balance is reported. Setting ON → `409 PAYMENT_REQUIRED` until the invoice is PAID, then it succeeds. The same applies to renewals. Only the Admin can change the setting (Manager, Receptionist, Trainer, Member → 403). Each change writes a `SETTINGS_CHANGED` audit row with old and new values. An outstanding balance never changes the access decision.** Renew creates a new row starting the day after the current end date, links `renewed_from_id`, writes a `RENEWED` event, and keeps old payments and attendance. Extend, suspend and reactivate follow the transition table. Invalid transitions return 409. | API | 3 |
| 4 | Allow check-in for an eligible member | `SIM-0001` with an ACTIVE membership covering today → GRANTED, with one attendance row and one GRANTED attempt (source SIMULATED). The first and last valid days are both granted (inclusive, in gym TZ). Manual check-in → GRANTED + audit log. | API, unit, E2E | 4 |
| 5 | Cancel a membership and **immediately** deny the next check-in | Scan → GRANTED. Cancel through the API. The **next** scan with the same ref → DENIED `MEMBERSHIP_CANCELLED`, even inside the duplicate window. A concurrent cancel and scan never leave a GRANTED attempt recorded after the cancel commit. History is still intact afterwards. | API, E2E | 4 |
| 6 | Deny an expired membership | Status `EXPIRED` → DENIED. Also: status still `ACTIVE` but `end_date` yesterday (nightly job not run yet) → DENIED `MEMBERSHIP_EXPIRED`. The expiry job flips the status and writes an `EXPIRED` event. | unit, API | 3–4 |
| 7 | Deny a suspended membership | Suspend → scan → DENIED `MEMBERSHIP_SUSPENDED`. Reactivate → scan → GRANTED. | API | 4 |
| 8 | Deny an unknown fingerprint | `NO_MATCH` → `MEMBER_NOT_RECOGNIZED`. Unenrolled `SIM-9999` → same. A revoked or deleted enrollment → same. No member is attached to the attempt. | API, unit | 4 |
| 9 | Deny when authorization cannot be verified | DB error injected into the eligibility query → DENIED `AUTHORIZATION_UNAVAILABLE` (HTTP 503) and no attendance row. Statement timeout → DENIED. A forced failure at commit time → DENIED (a grant is never returned before commit). Agent: backend timeout, connection refused, 5xx, or a 200 with a malformed or missing `decision` → DENIED, and the outbox entry is written. Kiosk: fetch failure → "Membership could not be verified". `DEVICE_ERROR` → `SCANNER_UNAVAILABLE`. A disabled device or bad key → `DEVICE_NOT_AUTHORIZED`. | API, agent, component | 4 |
| 10 | Record a payment and verify the updated history | A full payment → invoice `PAID`, receipt number issued, shown in `/members/:id/payments` and `/me/payments`. A partial payment → `PARTIALLY_PAID` with the correct outstanding balance. Overpayment → 400. Partial payment when the plan forbids it → 400. A refund above the paid amount → 400. A refund → invoice status recomputed, payment rows untouched. An overdue invoice becomes `OVERDUE` after its due date. `ONLINE` cannot be recorded as COMPLETED. Audit rows are written. | API, unit, E2E | 5 |
| 11 | Unauthorized staff cannot change membership status | Receptionist → 403 on cancel, suspend, reactivate and extend. Trainer → 403 on every membership mutation. Member → 403. Each time the database row is unchanged and no event is written. | API | 3 |
| 12 | Members cannot access other members' private records | Member A calling `/members/:B`, `/payments/:B-payment`, `/attendance?memberId=B`, `/members/:B/photo` → 403. `/me/*` returns only A's rows. Guessed IDs for B's receipt or booking → 404. Trainers cannot read unassigned members or payments. | API | 2–7 (each module) |
| 13 | Verify role permissions | **Table-driven matrix test:** for every (route, role) pair in the Section 5 matrix, assert allowed (2xx/4xx validation) or 403. Unauthenticated → 401. Missing CSRF → 403. A deactivated user's existing session → 401 on the next request. Only the Admin can change roles (no privilege escalation). Frontend: nav items and controls hidden per role (component test). | API, component | 1 (grows every stage) |
| 14 | Responsive layouts | Playwright at 360×800, 768×1024 and 1280×800 on the login, dashboard, members list, member detail, payment form, kiosk screens and portal pages: no horizontal overflow (`scrollWidth ≤ innerWidth`); the sidebar becomes a drawer below 1024px; tables become cards or scroll inside their own container. Keyboard-only navigation through login → members → record payment. Zero serious or critical axe violations. | E2E | 1 (shell), 8 (full pass) |
| 15 | Simulated vs real biometrics clearly distinguished | Attempts from a SIMULATED device always store `source=SIMULATED`, even if the request body claims `REAL`. A REAL device path (device-key auth, agent) stores `REAL`. `SIM-` refs are rejected on REAL devices. Simulator routes → 404 when disabled. The server refuses to start with the simulator enabled in production. The kiosk and access log show the SIMULATED banner or badge (component + E2E). The docs state that real hardware is untested until connected. | API, component, E2E | 4 |
| 16 | Reports match actual database records | A deterministic fixture set (known members, statuses, payments, refunds, attendance and denials across the date range). Every report and dashboard number is asserted against independently written raw SQL counts and sums, and against hand-computed expected values. The CSV export has the same rows as the JSON. Date-filter boundaries are inclusive and in gym TZ. Financial reports → 403 for Receptionist and Trainer. | API | 2–5 (dashboard cards), 8 (reports) |

### 8.3 Mandatory biometric test set (RULES.md §13)

All of these live in `test/integration/access.test.ts` and `test/unit/eligibility.test.ts`. They must pass at the end of every stage from Stage 4 onwards:

1. Active → GRANTED
2. Active, then cancelled → next scan DENIED immediately
3. Expired → DENIED
4. Suspended → DENIED
5. Unknown fingerprint → MEMBER_NOT_RECOGNIZED
6. Scanner unavailable → DENIED
7. Authorization unavailable → DENIED

Plus these additional cases:
- PENDING → denied
- Not started yet → denied
- Inactive or archived member → denied
- Access-blocked member → denied
- Outside plan hours → denied
- Duplicate scan inside the window → one attendance row, attempt marked duplicate
- Duplicate eventId → identical decision, no new row
- Check-out → does not make a later scan eligible
- A scan is never GRANTED without a committed attempt row
- Every attempt (granted and denied) is logged with time, member (if known), result, reason, device and source

### 8.4 Security and integrity tests (built with each module)

- Login: wrong password gives a generic error; lockout after the threshold; rate limit returns 429; argon2id hash format checked; password never in any response or log.
- Session: httpOnly + SameSite cookie flags; logout revokes the session; password change revokes other sessions; idle and absolute expiry.
- CSRF required on unsafe methods. Helmet headers present. CORS rejects other origins.
- Input: Zod rejects unknown fields (no mass assignment, e.g. a member PATCH cannot set `status`); SQL injection strings are stored as plain text; uploads with a fake extension or oversized files are rejected.
- Errors: a 500 response contains no stack trace, SQL or internal identifiers.
- Append-only: UPDATE or DELETE on `audit_logs`, `access_attempts`, `membership_events` and `attendance_corrections` fails at the database level. No DELETE routes exist for payments or attendance.
- Audit: every sensitive action listed in RULES.md §6 writes an audit row with actor, before/after values and reason.
- CSV export neutralizes formula injection (values starting with `= + - @` are prefixed with `'`).
- Classes and appointments: capacity is never exceeded under concurrent booking; duplicate booking → 409; a trainer double-booked across a class and an appointment → 409; the waitlist is promoted on cancellation.

### 8.5 Stage exit gate

At the end of every stage: the app starts without errors (server + web), and `npm run lint`, `npm run typecheck` and `npm test` all pass. From Stage 4 on, the E2E smoke suite also passes. Results go into the Stage Report with exact pass and fail counts.

---

## 9. Implementation Stages

Rules for every stage: one stage at a time; no features from later stages; nav items appear only for features that exist (no placeholder UI); every data screen has loading, empty, error and success states. Each stage ends with the exit gate (8.5) and a Stage Report, then I wait for "approved, continue".

**Mapping to requirements Section 20:**
- Phase 1 → Stage 1
- Phase 2 → Stages 2, 3 and 5
- Phase 3 → Stage 4
- Phase 4 → Stages 6 and 7
- Phase 5 → Stage 8

Access control (Stage 4) is deliberately placed **before** payments, because it is the top-priority rule and depends only on memberships.

### Stage 1: Foundation
- Monorepo (npm workspaces), TypeScript, ESLint and Prettier, `.env.example`, `.gitignore`, README skeleton.
- `packages/shared`: roles, the **full permission matrix**, enums, base Zod schemas.
- Server: env validation, pino logging with redaction, request IDs, helmet, CORS, central error handler, Drizzle + migrations (extensions, `users`, `user_sessions`, `staff_profiles`, `audit_logs` with its append-only trigger, `gym_settings`), seed for the first Admin.
- Auth: login, logout, me, change password; argon2id; DB sessions with httpOnly cookies; CSRF; login rate limit and lockout; `requirePermission` middleware; audit service.
- Staff accounts (Admin): list, create, edit, role, activate/deactivate, reset password. Settings screen. Audit log viewer.
- Web: design tokens (navy/charcoal sidebar, white content, blue primary, green success/granted, red denied; light + dark), base UI components, AppShell with responsive sidebar and drawer, role-aware navigation, login and forced password-change pages, protected routes, toasts, ConfirmDialog. The dashboard page shows the signed-in user's role home with only working quick actions.
- Tests: env and test-DB guard, auth and session security, CSRF, the permission-matrix harness (for routes that exist), audit rows, append-only trigger, responsive shell (Playwright at 3 widths).

### Stage 2: Members and membership plans
- Schema: `members` (sequence codes, partial unique email/phone, trigram search), `membership_plans`.
- Member CRUD, duplicate pre-check (email = hard block; phone = warning with a confirm-and-override dialog that requires a reason and is audit-logged, C2), archive and restore, photo upload with magic-byte validation and an authorized photo route, search, sort, filter and pagination, member detail page (tabs fill in as later stages add data), portal account creation (temporary password), access block and unblock.
- Plans CRUD (all 5 types, benefits, access hours), archive.
- Member portal shell + `/me/profile`. Demo seed (fictional, `is_demo`) + DEMO DATA banner.
- Dashboard cards: total members, today's registrations, recent member activity.
- Tests: scenario 1, scenario 12 (members part), matrix rows for members and plans.

### Stage 3: Membership lifecycle and history
- Schema: `memberships` (exclusion constraint, transition rules), `membership_events` (append-only).
- Assign (PENDING), activate, renew, extend, suspend, reactivate (optional extension by the suspended days), cancel. All transactional, with history and audit rows. Server-side date computation in gym TZ.
- Daily expiry job (cron + advisory lock). Expiring-soon list. Membership tab and history timeline on the member page. Portal `/me/membership`.
- Dashboard cards: active / expired / cancelled / suspended counts, expiring soon.
- Tests: scenarios 2 (without invoice), 3, 6 (job part), 11; unit tests for durations and transitions.

### Stage 4: Attendance and biometric access control (SIMULATED)
- Schema: `access_devices`, `access_attempts` (append-only), `attendance_records`, `attendance_corrections` (append-only), `biometric_consents`, `biometric_enrollments`.
- `AccessDecisionService` + pure `eligibility.ts`; device auth; `/access/scan`, offline denials, heartbeat; idempotency and duplicate window; manual check-in; check-out; corrections with audit trail.
- Simulated scanner panel + fixtures; kiosk screen (Access Granted / Access Denied / Member Not Recognized, SSE, SIMULATED banner); access-attempt log with filters; daily attendance list with search by member and date.
- Consent, enrollment and revoke screens (Admin/Manager); device management (Admin).
- `apps/biometric-agent` with ScannerAdapter, SimulatedAdapter, fail-closed backend client, outbox and heartbeat.
- `docs/BIOMETRICS.md`: hardware options, vendor checklist, setup, privacy, consent, retention and deletion.
- Portal `/me/attendance`. Dashboard: today's check-ins, recent check-in activity, denied attempts today.
- Tests: scenarios 4–9 and 15, the full set in 8.3, agent tests, kiosk component tests, E2E "cancel → next scan denied".

### Stage 5: Payments and billing
- Schema: `invoices`, `payments`, `refunds`.
- Invoice auto-created on membership assignment and renewal; manual invoices; record full or partial counter payments; refunds; void; server-side status and balance calculation; overdue job; printable receipt page; payment history on the member page and portal; payment and invoice lists with search and date filters.
- Activation policy (C1):
  - Add the `require_full_payment_before_activation` setting (default OFF; Admin-only toggle on the Settings screen, with a confirmation dialog and audit log).
  - Enforce it in activate and renew.
  - Show the outstanding balance on membership cards, the member page and the portal.
- Online payment: not built; documented as REQUIRES CONFIGURATION (D8).
- Dashboard: monthly revenue, pending and overdue payments, "record payment" quick action.
- Tests: scenario 10, scenario 2 (invoice part), scenario 3 (activation-policy part), scenario 12 (payments part), concurrency on refunds and overpayment, matrix rows for billing.

### Stage 6: Staff, trainers, schedules, classes and appointments
- Schema: `trainer_profiles`, `trainer_assignments`, `trainer_availability`, `trainer_time_off`, `staff_shifts`, `fitness_classes`, `class_sessions`, `class_bookings`, `appointments` (all with their exclusion constraints).
- Trainer profiles and specializations, assigning members to trainers, staff shift schedules, trainer availability and time off, trainer schedule view.
- Class templates, sessions (single + weekly recurrence), capacity, bookings, waitlist with promotion, cancellations, class attendance marking.
- Personal-training appointments with availability and conflict checks.
- Trainer dashboard (own schedule and members). Portal: trainers, schedule, book or cancel eligible classes, appointments.
- Tests: duplicate or conflicting bookings, capacity under concurrency, trainer scoping (scenarios 12 and 13 rows).

### Stage 7: Workouts, equipment and notifications
- Schema: exercises, workout plans, items, assignments, logs, progress entries; equipment, maintenance records; notifications, notification deliveries.
- Exercise library with images; plan builder (days, sets, reps, duration, rest); assigning plans to members; trainer notes; completion logs; progress history with chart. Portal: workouts and progress.
- Equipment register, condition and status, maintenance records, next-maintenance reminders.
- In-app notifications (bell, list, read/unread) generated by jobs and events for every type in requirements §12. Email, SMS and WhatsApp channel adapters that are **active only when credentials are set**; otherwise deliveries are recorded as `NOT_CONFIGURED`. A channels status screen. `docs/NOTIFICATIONS.md` documents what works and what requires configuration.
- Tests: trainer can only assign plans to assigned members, maintenance updates, notification dedupe, channel-not-configured behaviour (no network calls in tests).

### Stage 8: Dashboard, reports, hardening and documentation
- Dashboard completed: date filters, revenue and attendance charts, activity feed, role-specific views.
- Reports (all types in 4.9) with summary cards, charts, date filters and CSV export; financial reports restricted.
- Security pass: review every route against the matrix, rate limits on sensitive endpoints, dependency audit (`npm audit`), header review, a review of error messages.
- Full responsive and accessibility pass (scenario 14), the full E2E acceptance suite for all 16 scenarios.
- Documentation: README (setup on Windows, PostgreSQL install, commands), `docs/SECURITY.md`, `docs/API.md`, final `docs/BIOMETRICS.md` and `docs/NOTIFICATIONS.md`, and a demo vs production data guide.
- Tests: scenario 16 and the complete regression run.

**After Stage 8 (only on request):** real scanner adapter for the chosen hardware; online payment provider; S3 storage.

---

## 10. Risks and Dependencies

| Risk | Impact | Mitigation |
|---|---|---|
| No physical scanner available | Real biometrics cannot be verified | SIMULATED scanner, a modular adapter interface, honest labelling, and a hardware checklist in BIOMETRICS.md |
| Access terminals open the door on a match by default | The backend would be **bypassed**, breaking the core rule | Configure identify-only / no relay; the relay is driven by the agent only after a GRANTED decision. This is on the hardware setup checklist and must be tested on site. |
| Fail-closed means no entry during an internet or server outage | Business disruption | Documented offline procedure (staff manual entry outside the system, reconciled later); health monitoring; the local network can host the server |
| Timezone mistakes around midnight | Wrong grant or deny on the first or last day | All validity checks use calendar dates in `GYM_TIMEZONE`, with boundary unit tests |
| Shared family phone numbers hide real duplicates | Duplicate member records | Phone is a warning with a required reason and an audit log. A same-name + same-phone match gets a stronger warning. Email stays unique (C2). |
| Activation with an unpaid balance | Revenue leakage | The outstanding balance is visible everywhere, and the overdue job and reminders run. The Admin can switch on "require full payment before activation" (C1). |
| Native modules on Windows (`argon2`) | Install failures | Prebuilt binaries exist for Node 24 on Windows; fallback is `bcrypt` (needs approval) |
| Biometric data law | Legal exposure | Minimal data, consent, retention and deletion procedures; recommend legal review |
| WhatsApp / SMS approvals | Delays | Channels are optional; in-app notifications always work |
| Scope size | Quality drop | Strict staging, tests at every stage, no later-stage features |

---

## 11. Progress

| Stage | Name | Status | Approved | Notes |
|---|---|---|---|---|
| 0 | Planning (this document) | **Done** | 2026-10-14 | D1–D8 approved; C1 (activation policy) and C2 (duplicate phone warning) incorporated |
| 1 | Foundation | **Done** | 2026-10-14 | Exit gate passed 2026-10-14: lint 0 problems, typecheck 0 errors, `npm test` 230/230 (shared 69, server 138, web 23; corrected from 229 on 2026-10-17), `npm run test:e2e` 14/14; server + web start, `/health/ready` reports the database OK. Re-run before approval: same results; `gym_dev` row counts identical before and after the E2E run. |
| 2 | Members and membership plans | **Done** | 2026-10-17 | Exit gate passed 2026-10-17: lint 0 problems, typecheck 0 errors, format check clean, `npm test` 473/473 (shared 85, server 359, web 29), `npm run test:e2e` 23/23 (against `gym_test` only). Migrations 0002–0003 applied to `gym_dev`; server + web start. |
| 3 | Membership lifecycle and history | **Done** | 2026-10-18 | Exit gate passed 2026-10-18: lint 0 problems, typecheck 0 errors, format check clean, `npm test` 646/646 (shared 103, server 496, web 47), `npm run test:e2e` 24/24 (against `gym_test` only). Migrations 0004–0005 applied to `gym_dev`; server + web start and the expiry job runs at startup. |
| 4 | Attendance and biometric access control (SIMULATED) | **Built — exit gate incomplete** | — | 2026-10-20: lint 0 problems, typecheck 0 errors, format check clean; shared 117/117, agent 42/42, web 74/74. Server 756/756 on 2026-10-20 05:17 UTC (after the last server source change; since then only Prettier formatting and the E2E fixture script changed). **Blocked since 10:58 UTC:** Windows Smart App Control blocks PostgreSQL's unsigned `btree_gist.dll`, so the test database cannot be reset — the server suite and `npm run test:e2e` (incl. the new `access.spec.ts`) could not be re-run, and browser verification of the Stage 4 screens is outstanding. Migrations 0006–0007 applied to `gym_dev` on 2026-10-20; the running dev server reports `/health/ready` database OK and the Stage 4 routes answer 401 when signed out. |
| 5 | Payments and billing | Not started | — | |
| 6 | Staff, trainers, schedules, classes and appointments | Not started | — | |
| 7 | Workouts, equipment and notifications | Not started | — | |
| 8 | Dashboard, reports, hardening and documentation | Not started | — | |

**Section 19 scenario tracker:**

| # | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Status | **Pass (2)** | Partial (2–3) | Partial (3) | Partial (4) | Partial (4) | **Pass (3–4)** | **Pass (4)** | **Pass (4)** | **Pass (4)** | — | **Pass (3)** | Partial (2–4) | Partial (1–4) | Partial (1–3) | Partial (4) | Partial (2–3) |

(Each cell becomes **Pass** with the stage number once its automated tests pass.)

- **1 — Pass (2):** every clause in §8.2 is covered in `members.test.ts` (GM- code, duplicate email hard block, duplicate phone warning → override with reason → one audit row, reason required, same-name flag, phone change on update, Trainer/Member 403, validation, archived email re-use, search/sort/filter/pagination); E2E: the receptionist registers a member through the form, including the shared-phone override and a photo upload.
- **2 — Partial (2–3):** plan part (Stage 2: all 5 types, duration/price/access validation, archive) and assignment (Stage 3): `PENDING` with server-computed inclusive dates (month-end rule) and plan snapshots, a `CREATED` event and audit row, overlap rejected by the exclusion constraint (also under concurrent requests), archived plan rejected, start date window enforced; E2E: reception assigns through the dialog. The invoice part comes in Stage 5.
- **3 — Partial (3):** `PENDING → ACTIVE` writes `ACTIVATED`; renew creates a new row from the day after the latest current end date, links `renewed_from_id`, writes `RENEWED` and keeps the old row; extend, suspend (reason required), reactivate (optional extension by the suspended days) and cancel (reason required) follow §3.3; invalid transitions → 409 `INVALID_STATUS_TRANSITION`; a stale `version` → 409 `STALE_VERSION`; each action writes exactly one event and one audit row in the same transaction. The C1 payment-policy clauses (setting ON → `PAYMENT_REQUIRED`, Admin-only setting changes) need invoices and are tested in Stage 5; until then activation and renewal behave as with the setting OFF.
- **4 — Partial (4):** API/unit: `SIM-0001` with an active membership → GRANTED with one attendance row and one SIMULATED attempt; first and last valid days granted in gym TZ; manual check-in → GRANTED + audit row. Component: the kiosk shows Access Granted with the plan line. E2E (`access.spec.ts`) written but not yet run (environment block).
- **5 — Partial (4):** API: scan → GRANTED, cancel, the next scan → DENIED `MEMBERSHIP_CANCELLED` inside the duplicate window (eligibility runs before the duplicate check); concurrent cancel + scan never records a GRANTED attempt after the cancel commit; history intact. E2E "cancel → next scan denied" written, not yet run.
- **6 — Pass (3–4):** job part (Stage 3) — the daily expiry job flips `ACTIVE` rows whose `end_date` is before today in gym TZ to `EXPIRED`, writing an `EXPIRED` event and a system audit row; it is idempotent, skips when another run holds the advisory lock, and skips rows locked by a running action. Access part (Stage 4): status `EXPIRED`, and `ACTIVE` with `end_date` yesterday, → DENIED `MEMBERSHIP_EXPIRED`.
- **7 — Pass (4):** suspend → DENIED `MEMBERSHIP_SUSPENDED`; reactivate → GRANTED.
- **8 — Pass (4):** `NO_MATCH`, unenrolled `SIM-9999`, revoked and deleted enrollments → `MEMBER_NOT_RECOGNIZED` with no member on the attempt; kiosk component shows Member Not Recognized.
- **9 — Pass (4):** DB error, statement timeout and a forced commit failure → DENIED `AUTHORIZATION_UNAVAILABLE` (503) and no attendance row; agent: timeout, connection refused, 5xx, malformed/missing `decision` → DENIED + outbox entry; kiosk: network error, 500, malformed body and a contradictory GRANTED → "could not be verified"; `DEVICE_ERROR` → `SCANNER_UNAVAILABLE`; disabled device or bad key → `DEVICE_NOT_AUTHORIZED`.
- **15 — Partial (4):** SIMULATED devices always store `source=SIMULATED`; REAL devices store `REAL` and reject `SIM-` refs; simulator routes 404 when disabled; the server refuses to start with the simulator on in production; kiosk component tests show the banner for simulated devices and none for real ones; `docs/BIOMETRICS.md` states real hardware is untested. E2E banner checks written, not yet run.
- **11 — Pass (3):** Receptionist → 403 on cancel, suspend, reactivate and extend; Trainer and Member → 403 on every membership mutation; each time the row, its events and the audit log are unchanged. Component test: the Membership tab shows only the actions the role may take.
- **12 — Partial (2–3):** members part — member A gets 403 on B's `/members/:id`, photo and every staff member route; `/me/profile` returns only A's row and ignores any id in the request; trainers see no members until Stage 6 assignments. Memberships part (Stage 3): `/me/membership` and `/me/memberships` return only A's rows, staff get 403 there, and members get 403 on every staff membership route. Attendance (Stage 4): `/me/attendance` returns only the member's own valid visits (voided ones drop out); members get 403 on `/attendance/*`, `/access/attempts` and `/members/:id/attendance` · `/access-attempts` (permission matrix). Payments and bookings follow in their stages.
- **16 — Partial (2–3):** dashboard member cards (current members, registered today in gym time) asserted against raw SQL counts; recent member activity carries no personal field values. Stage 3: membership cards (active, pending, suspended, expired, cancelled, expiring within 7 days without a renewal) asserted against raw SQL and hand-computed values, and membership changes appear in recent activity. Stage 4 attendance cards (check-ins today, denied today, recent check-ins) are built and hidden from Trainers (tested), but their counts are not yet asserted against raw SQL.
- **13 — Partial (1–3):** the table-driven matrix test covers every Stage 1 route × all 5 roles (403 when not allowed) plus every Stage 2 members and plans route (Stage 2) and every Stage 3 membership and `/me/membership(s)` route (Stage 3), and every Stage 4 access, attendance, device and biometric route (Stage 4; Admin/Manager only for consent and enrollment, Admin only for devices), plus 401 when signed out; missing CSRF → 403; a deactivated user's session → 401; only the Admin can change roles, never their own; role-aware navigation component test. Grows with each stage's routes.
- **14 — Partial (1–3):** Playwright at 360×800, 768×1024 and 1280×800 on login, dashboard, members list, member detail (profile and Membership tab), memberships, expiring soon, plans, staff, settings, audit log, account and the member portal (profile, my membership, plans); each screen must also load without an error state: no horizontal overflow, sidebar ≥ 1024px and drawer below (opens, navigates, closes on Escape), zero axe WCAG 2.1 A/AA violations. Axe also runs on the register-member, plan and assign-membership dialogs and on the membership history. Stage 4 adds check-in desk, attendance, access log, scanners, the member Attendance tab, My attendance and the full-screen kiosk at 360×800 and 1280×800 — written, not yet run (environment block). The payment pages and the keyboard-only payment flow come in their stages (full pass: Stage 8).

**Plan change log:**

| Date | Change | Approved by |
|---|---|---|
| 2026-10-14 | Initial plan (Stage 0) | — |
| 2026-10-14 | D1–D8 approved. D5 set to `Asia/Karachi` / `PKR`. D7 confirmed (PostgreSQL 17.11). | User |
| 2026-10-14 | C1: activation allowed with an outstanding balance; Admin-only setting "require full payment before activation" (default OFF, audit-logged) | User |
| 2026-10-14 | C2: duplicate phone becomes an overridable warning (reason required, audit-logged); duplicate email stays blocked | User |
| 2026-10-14 | Stage 1: small supporting dependencies added — `cors` (API), `concurrently` (root `npm run dev`), `@fontsource-variable/inter` (self-hosted Inter font, no external font CDN); TypeScript pinned to `~6.0`. No change to the approved stack. | User (with the Stage 1 report) |
| 2026-10-14 | Stage 1: Playwright Chromium browser installed for E2E tests | User |
| 2026-10-14 | Stage 1: local databases — the user created `gym_dev` and `gym_test`; the least-privilege `gym_app` role (LOGIN, no superuser / createdb / createrole) was created as their owner with a generated password written only to `.env`; extensions `pgcrypto`, `citext`, `pg_trgm`, `btree_gist` installed | User |
| 2026-10-14 | Stage 1: `docs/` excluded from Prettier so the hand-written requirements, rules and plan are never reformatted | — (tooling only) |
| 2026-10-17 | Stage 2: §11 Stage 1 test total corrected from 229 to 230 (69 + 138 + 23) | — (record fix) |
| 2026-10-17 | Stage 2: added `GET · POST /me/profile/photo` (a member views and replaces their own photo through an authorized route, as §4.10 allows photo edits). `/members/check-duplicate` also accepts `firstName`/`lastName` so the form can flag a same-name + same-phone match before saving. | User (with the Stage 2 report) |
| 2026-10-17 | Stage 2: one app shell with role-based navigation instead of a separate portal shell; members get My profile, Plans and My account. The DEMO DATA banner is shown on staff screens only. | User (with the Stage 2 report) |
| 2026-10-18 | Stage 3: month plans end the day before the same date N months later; when that date does not exist the period runs to the end of the shorter month (31 Jan + 1 month → 28/29 Feb), so no period is cut short. | User (with the Stage 3 report) |
| 2026-10-18 | Stage 3: until invoices exist (Stage 5), activation and renewal behave as with C1 OFF — a renewal is created directly `ACTIVE` (starting after the current period); a pending period whose dates have passed cannot be activated or suspended (`409 MEMBERSHIP_PERIOD_ENDED`, cancel and reassign). | User (with the Stage 3 report) |
| 2026-10-18 | Stage 3: renew only from the member's latest membership (`409 NOT_LATEST_MEMBERSHIP`); a start date may be chosen from 30 days back to 365 days ahead; extend adds 1–365 days and cannot run into the next period; every action sends the row's `version` and a stale one gets `409 STALE_VERSION`. | User (with the Stage 3 report) |
| 2026-10-18 | Stage 3: the expiry job runs daily at 00:05 gym time and once at server start, under a PostgreSQL advisory lock so only one process runs it. | User (with the Stage 3 report) |
| 2026-10-18 | Stage 3: UI — the member page gets Profile / Membership tabs (`?tab=membership`, shareable link); a staff Memberships list page (`/memberships`, with the expiring-soon view at `?expiring=7`); My membership in the member portal. Toast colors mapped to the design tokens so success/error toasts meet AA contrast. | User (with the Stage 3 report) |
| 2026-10-20 | Stage 4: scan decisions run eligibility (steps 5–8) **before** the duplicate-window check, so a cancel inside the 60 s window still denies; a duplicate inside the window is only possible for a still-eligible member. | — (follows §3.5 / RULES §4) |
| 2026-10-20 | Stage 4: web routes `/check-in` (desk + simulated-scanner panel), `/kiosk/:deviceId` (full-screen), `/attendance`, `/access-log`, `/devices` (Scanners, Admin), `/portal/attendance`; the member page gains an Attendance tab and a Fingerprint card; nav gets an "Entrance" section. Kiosk colour tokens added to `tokens.css`. | User (with the Stage 4 report) |
| 2026-10-20 | Stage 4: the browser re-checks every decision (`parseDecision`): a schema failure, or `GRANTED` with a non-granted reason, is shown as "Membership could not be verified" (fail closed). | — (follows RULES §4) |
| 2026-10-20 | Stage 4: the simulator fixture list includes an `AUTHORIZATION_UNAVAILABLE` case; simulator buttons carry explicit accessible names; the one-time device-key field got a proper label. | — (UI/a11y only) |
| 2026-10-20 | Stage 4: E2E fixtures add a second portal member used only by the entrance flow, and the Playwright API server runs with `BIOMETRIC_SIMULATOR_ENABLED=true` (test only, never production). | — (test only) |
| 2026-10-20 | Stage 4: the biometric retention job (§6.6) is **not built**; `biometric_retention_days` exists and `docs/BIOMETRICS.md` documents the manual review until the job is added. | Pending user decision |
