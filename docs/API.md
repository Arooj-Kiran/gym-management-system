# API Reference

The REST API behind the staff dashboard, the member portal and the biometric agent. This page
covers the conventions every route follows and indexes every route by module. The request and
response types live in `packages/shared/src/schemas` (Zod schemas and TypeScript interfaces), and
the role-permission matrix is in `packages/shared/src/permissions.ts` (summarised in
`docs/PLAN.md` §5).

## Conventions

### Base path and format

- Base path: `/api/v1`. Every request and response body is JSON (`Content-Type: application/json`)
  except image uploads (`multipart/form-data`), images, receipts and CSV exports.
- Request bodies are limited to 100 KB. Image uploads are limited by `MAX_UPLOAD_MB` (default
  2 MB). The type is decided by the file's magic bytes (JPEG, PNG or WebP), never by its name or
  the `Content-Type` the client sends.
- Unknown fields are rejected. Every body, query and path parameter goes through a strict Zod
  schema, so a typo such as `?pagesize=` is a `400`, not a silently ignored filter.

### Authentication

| Caller                  | How it authenticates                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff and members       | `POST /auth/login` sets an httpOnly, `SameSite=Strict` session cookie (`Secure` in production). The session ends after `SESSION_TTL_HOURS` (default 12) or `SESSION_IDLE_MINUTES` (default 60) without a request. |
| Biometric agent (device) | `Authorization: Device <deviceId>.<deviceKey>`. The key is shown once when the device is created or its key is rotated; the server stores only its SHA-256 hash.                                                     |

- **CSRF.** Every `POST`, `PATCH`, `PUT` and `DELETE` from a signed-in user needs the
  `X-CSRF-Token` header. The token comes from `GET /auth/me`. A request whose `Origin` is not
  `WEB_ORIGIN` is rejected with `403 ORIGIN_NOT_ALLOWED` before anything else runs.
- **Forced password change.** While `mustChangePassword` is true, only `/auth/me`,
  `/auth/logout` and `/auth/change-password` work; everything else returns
  `403 PASSWORD_CHANGE_REQUIRED`.
- **Members** use the same login. Their data is under `/me/*`, and the member ID always comes from
  the session, never from the URL or the body. A member calling a staff route gets `403`.

### Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Check the highlighted fields.",
    "details": [{ "path": "to", "message": "\"To\" must be on or after \"From\"" }]
  }
}
```

| Status | Typical codes                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED` (with `details`), `INVALID_JSON`, business rules such as `OVERPAYMENT`                                                    |
| 401    | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` (the same message whether the email or the password was wrong)                                       |
| 403    | `FORBIDDEN`, `CSRF_INVALID`, `ORIGIN_NOT_ALLOWED`, `PASSWORD_CHANGE_REQUIRED`                                                                 |
| 404    | `NOT_FOUND` (also on `/me` routes for a record that belongs to someone else, so IDs cannot be probed)                                            |
| 409    | State conflicts: `STALE_VERSION`, `INVALID_STATUS_TRANSITION`, `MEMBERSHIP_OVERLAP`, `PAYMENT_REQUIRED`, `DUPLICATE_EMAIL`, `SCHEDULE_CONFLICT` |
| 413    | `PAYLOAD_TOO_LARGE`                                                                                                                           |
| 429    | `RATE_LIMITED` (with `RateLimit` and `RateLimit-Policy` headers)                                                                              |
| 500    | `INTERNAL_ERROR`. The message carries only a reference ID that matches the server log; never a stack trace, SQL or data.                     |
| 503    | Access decisions only: `AUTHORIZATION_UNAVAILABLE` (the entry is denied; see `docs/BIOMETRICS.md`)                                             |

The full list of codes is `ERROR_CODES` in `packages/shared/src/enums.ts`.

The permission check runs before the input is validated, so a role that may not use a route
always gets `403`, whatever it sends.

### Lists

List routes take `page` (from 1), `pageSize` (1–100, default 20) and, where it makes sense, `q`,
`sort` and `order` (`asc` · `desc`) plus the filters shown below. They return:

```json
{ "data": [], "page": 1, "pageSize": 20, "total": 0 }
```

### Values

- **Money** is an integer in minor units (`amountMinor: 250000` is PKR 2,500.00). The currency is
  `CURRENCY_CODE`.
- **Calendar dates** (`startDate`, `from`, `to`, `date`) are `YYYY-MM-DD` in the gym's time zone
  (`GYM_TIMEZONE`, default `Asia/Karachi`). Date ranges include both ends.
- **Instants** (`checkInAt`, `receivedAt`, `createdAt`) are ISO 8601 in UTC.
- **Optimistic locking.** Memberships carry a `version`. Send it back with a status change; a
  stale one returns `409 STALE_VERSION`.

### Rate limits

| What                                               | Limit                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /auth/login`                                 | `LOGIN_RATE_LIMIT_MAX` failed attempts per `LOGIN_RATE_LIMIT_WINDOW_MINUTES`, per IP and per account; plus account lockout after `ACCOUNT_LOCKOUT_THRESHOLD` failures |
| `POST /auth/change-password`                       | Twice the login limit per user                                                          |
| `POST /access/scan`, `/access/offline-denials`     | `ACCESS_SCAN_RATE_LIMIT_PER_MINUTE` per device                                          |
| `GET /reports/:type`, `GET /dashboard/charts/*`    | 60 per minute per user                                                                  |

### Caching

Every `/api` response sends `Cache-Control: no-store`, so no browser or proxy keeps a copy of
personal, financial or access data. The one exception is images (member photos, exercise
images): `private, max-age=86400`, so only the signed-in browser may keep them, for a day. Membership
eligibility is never cached anywhere: every access decision reads the database at the moment of
the scan.

## Routes

**Permission** is a key from the matrix; "any" means any signed-in user, **public** needs no
session and **device** needs the device `Authorization` header. "Own" and "Assigned" scopes are
applied by the server, not by the caller.

### Health and auth

| Method | Path                    | Permission | Notes                                                    |
| ------ | ----------------------- | ---------- | -------------------------------------------------------- |
| GET    | `/health`               | public     | Liveness                                                 |
| GET    | `/health/ready`         | public     | `503` when the database is unreachable                   |
| POST   | `/auth/login`           | public     | `{ email, password }`. Rate-limited, generic error.      |
| POST   | `/auth/logout`          | any        | Revokes the session                                      |
| GET    | `/auth/me`              | any        | User, role, permissions, `csrfToken`, `mustChangePassword` |
| POST   | `/auth/change-password` | any        | Revokes the user's other sessions                        |

### Staff, settings and audit

| Method      | Path                                                  | Permission                                  |
| ----------- | ----------------------------------------------------- | ------------------------------------------- |
| GET · POST  | `/staff`                                              | `staff:read` · `staff:manage`               |
| GET · PATCH | `/staff/:id`                                          | `staff:read` · `staff:manage`               |
| PATCH       | `/staff/:id/role`                                     | `staff:assign-role` (never your own; the last Admin cannot be removed) |
| POST        | `/staff/:id/activate` · `/deactivate` · `/reset-password` | `staff:manage`                          |
| GET · PATCH | `/settings`                                           | `settings:read` · `settings:manage`         |
| GET         | `/audit-logs`                                         | `audit:read`                                |

### Members

| Method      | Path                                                                   | Permission                                      |
| ----------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| GET · POST  | `/members`                                                             | `members:read` (Trainer: assigned, reduced fields) · `members:create` |
| GET         | `/members/check-duplicate?email=&phone=&excludeId=`                    | `members:create` or `members:update`            |
| GET · PATCH | `/members/:id`                                                         | `members:read` · `members:update`               |
| POST        | `/members/:id/archive` · `/restore`                                    | `members:archive`                               |
| GET · POST  | `/members/:id/photo`                                                   | `members:read` · `members:update`               |
| POST        | `/members/:id/portal-account`                                          | `members:update`                                |
| POST        | `/members/:id/access-block` · `/access-unblock`                        | `access:restrict`                               |
| GET         | `/members/:id/memberships` · `/membership-events`                      | `memberships:read`                              |
| GET         | `/members/:id/attendance` · `/access-attempts`                         | `attendance:read`                               |
| GET         | `/members/:id/invoices` · `/payments`                                  | `payments:read`                                 |
| GET · POST  | `/members/:id/progress`                                                | `progress:read` · `progress:record`             |

`POST /members` returns `409 DUPLICATE_EMAIL` (always) and `409 DUPLICATE_PHONE_WARNING` unless
the body has `confirmDuplicatePhone: true` and a `duplicatePhoneReason` (audit-logged).

### Membership plans and memberships

| Method      | Path                                                          | Permission                     |
| ----------- | ------------------------------------------------------------- | ------------------------------ |
| GET · POST  | `/membership-plans`                                           | `plans:read` · `plans:manage`  |
| GET · PATCH | `/membership-plans/:id`                                       | `plans:read` · `plans:manage`  |
| POST        | `/membership-plans/:id/archive` · `/unarchive`                | `plans:manage`                 |
| GET · POST  | `/memberships`                                                | `memberships:read` · `memberships:assign` |
| GET         | `/memberships/:id` · `/memberships/:id/events`                | `memberships:read`             |
| POST        | `/memberships/:id/activate`                                   | `memberships:activate`         |
| POST        | `/memberships/:id/renew`                                      | `memberships:renew`            |
| POST        | `/memberships/:id/extend` · `/suspend` · `/reactivate` · `/cancel` | `memberships:change-status` |

Assigning creates a `PENDING` membership and, for a paid plan, its invoice. Activation and renewal
return `409 PAYMENT_REQUIRED` while the Admin setting "require full payment before activation" is
on and the invoice is not paid. Cancelling takes effect for the very next scan.

### Access control, attendance, devices and biometrics

| Method      | Path                                                     | Permission                                    | Notes                                                                 |
| ----------- | -------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| POST        | `/access/scan`                                           | **device**                                    | `{ eventId, matchResult, templateRef?, errorCode?, occurredAt }` → decision |
| POST        | `/access/offline-denials`                                | **device**                                    | Always stored as DENIED / `AUTHORIZATION_UNAVAILABLE`                 |
| POST        | `/devices/heartbeat`                                     | **device**                                    | Scanner health                                                        |
| POST        | `/access/simulate`                                       | `access:simulate`                             | **SIMULATED.** `404` unless `BIOMETRIC_SIMULATOR_ENABLED=true`        |
| GET         | `/access/simulator/fixtures`                             | `access:simulate`                             | Fake `SIM-` IDs only                                                  |
| GET         | `/access/devices`                                        | `access:monitor`, `access:read-log` or `access:simulate` | Device names and status for the desk screens              |
| GET         | `/access/stream?deviceId=`                               | `access:monitor`                              | Server-Sent Events for the kiosk                                      |
| GET         | `/access/attempts`                                       | `access:read-log`                             | Filters: `result, reason, source, deviceId, memberId, from, to`       |
| POST        | `/attendance/manual-check-in`                            | `attendance:manual-check-in`                  | Same decision as a scan, source MANUAL, audit-logged                  |
| GET         | `/attendance` · `/attendance/today`                      | `attendance:read`                             |                                                                       |
| POST        | `/attendance/:id/check-out`                              | `attendance:check-out`                        |                                                                       |
| GET · POST  | `/attendance/:id/corrections`                            | `attendance:read` · `attendance:correct`      | Reason required, audit-logged                                         |
| GET · POST  | `/devices`                                               | `devices:manage`                              | POST returns the device key once                                      |
| GET · PATCH | `/devices/:id`                                           | `devices:manage`                              |                                                                       |
| POST        | `/devices/:id/rotate-key` · `/disable` · `/enable`       | `devices:manage`                              |                                                                       |
| GET         | `/members/:id/biometric`                                 | `biometrics:read-status`                      | Template refs are masked                                              |
| POST        | `/members/:id/biometric/consent` · `/consent/withdraw`   | `biometrics:manage`                           | Withdrawing revokes every enrollment                                  |
| POST        | `/members/:id/biometric/enrollments`                     | `biometrics:manage`                           | Consent required                                                      |
| POST        | `/biometric/enrollments/:id/revoke`                      | `biometrics:manage`                           | Queues deletion on the device                                         |
| POST        | `/biometric/enrollments/:id/confirm-deletion`            | **device**                                    | The agent confirms the template is gone                               |

How the decision is made, and why every failure denies entry, is in `docs/BIOMETRICS.md`.

### Billing

| Method     | Path                                   | Permission                          |
| ---------- | -------------------------------------- | ----------------------------------- |
| GET · POST | `/invoices`                            | `payments:read` · `payments:record` |
| GET        | `/invoices/:id`                        | `payments:read`                     |
| POST       | `/invoices/:id/void`                   | `payments:void`                     |
| GET · POST | `/payments`                            | `payments:read` · `payments:record` |
| GET        | `/payments/:id` · `/payments/:id/receipt` | `payments:read`                  |
| POST       | `/payments/:id/refunds`                | `payments:refund`                   |
| GET        | `/refunds`                             | `payments:read`                     |

Counter methods only (cash, card, bank transfer; card and bank transfer need a reference). Online
payment is **REQUIRES CONFIGURATION**: the API refuses `ONLINE`, and no provider webhook exists
until a provider is chosen.

### Trainers, schedules, classes and appointments

| Method      | Path                                                          | Permission                                          |
| ----------- | ------------------------------------------------------------- | --------------------------------------------------- |
| GET         | `/trainers` · `/trainers/:id`                                 | `trainers:read`                                     |
| PATCH       | `/trainers/:id`                                               | `trainers:manage` (or the trainer's own bio)        |
| GET · PUT   | `/trainers/:id/availability`                                  | `trainers:read` · `trainers:manage-availability`    |
| POST        | `/trainers/:id/time-off` · `/time-off/:id/cancel`             | `trainers:manage-availability`                      |
| GET         | `/trainers/:id/schedule?from=&to=`                            | `trainers:read`                                     |
| GET         | `/trainers/:id/available-slots?date=&durationMinutes=`        | `appointments:read`                                 |
| GET         | `/trainers/:id/members`                                       | `trainer-assignments:read` (Trainer: own list)      |
| GET · POST  | `/trainer-assignments` · POST `/trainer-assignments/:id/end`  | `trainer-assignments:read` · `trainer-assignments:manage` |
| GET · POST  | `/shifts` · PATCH `/shifts/:id` · POST `/shifts/:id/cancel`   | `schedules:read` (Receptionist, Trainer: own) · `schedules:manage` |
| GET · POST  | `/classes` · GET · PATCH `/classes/:id` · POST `/classes/:id/archive` | `classes:read` · `classes:manage`          |
| GET · POST  | `/class-sessions` · GET · PATCH `/class-sessions/:id` · POST `/class-sessions/:id/cancel` | `classes:read` · `classes:manage` |
| GET · POST  | `/class-sessions/:id/bookings`                                | `bookings:read` · `bookings:manage`                 |
| POST        | `/bookings/:id/cancel`                                        | `bookings:manage`                                   |
| POST        | `/bookings/:id/attendance`                                    | `classes:mark-attendance` (Trainer: own sessions)   |
| GET · POST  | `/appointments`                                               | `appointments:read` · `appointments:manage`         |
| GET · PATCH | `/appointments/:id`                                           | `appointments:read` · `appointments:manage`         |
| POST        | `/appointments/:id/cancel` · `/complete` · `/no-show`         | `appointments:manage`                               |

### Workouts, equipment and notifications

| Method      | Path                                                           | Permission                                    |
| ----------- | -------------------------------------------------------------- | --------------------------------------------- |
| GET · POST  | `/exercises`                                                   | `exercises:read` · `exercises:manage`         |
| GET · PATCH | `/exercises/:id`                                               | `exercises:read` · `exercises:manage`         |
| GET · POST  | `/exercises/:id/image`                                         | `exercises:read` · `exercises:manage`         |
| POST        | `/exercises/:id/archive`                                       | `exercises:manage`                            |
| GET · POST  | `/workout-plans`                                               | `workouts:read` · `workouts:manage`           |
| GET · PATCH | `/workout-plans/:id`                                           | `workouts:read` · `workouts:manage`           |
| PUT         | `/workout-plans/:id/items`                                     | `workouts:manage`                             |
| POST        | `/workout-plans/:id/duplicate` · `/archive`                    | `workouts:manage`                             |
| GET · POST  | `/workout-assignments`                                         | `workouts:read` · `workouts:assign` (Trainer: assigned members) |
| GET · PATCH | `/workout-assignments/:id`                                     | `workouts:read` · `workouts:assign`           |
| GET · POST  | `/workout-logs`                                                | `workouts:read` · `workouts:log`              |
| GET · POST  | `/equipment`                                                   | `equipment:read` · `equipment:manage`         |
| GET         | `/equipment/maintenance-due?days=`                             | `equipment:read`                              |
| GET · PATCH | `/equipment/:id`                                               | `equipment:read` · `equipment:manage`         |
| POST        | `/equipment/:id/status`                                        | `equipment:manage`                            |
| GET · POST  | `/equipment/:id/maintenance`                                   | `equipment:read` · `equipment:manage`         |
| GET         | `/notifications` · `/notifications/unread-count`               | any (own only)                                |
| POST        | `/notifications/:id/read` · `/notifications/read-all`          | any (own only)                                |
| GET         | `/notifications/channels`                                      | `settings:read`                               |

Email, SMS and WhatsApp are **REQUIRES CONFIGURATION** until their credentials are set; see
`docs/NOTIFICATIONS.md`.

### Dashboard and reports

| Method | Path                                                      | Permission                                                         |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/dashboard/summary?from=&to=`                            | `dashboard:read`. Cards depend on the role (below).                |
| GET    | `/dashboard/activity`                                     | `dashboard:read`                                                   |
| GET    | `/dashboard/charts/revenue?from=&to=&interval=`           | `reports:financial`                                                |
| GET    | `/dashboard/charts/attendance?from=&to=&interval=`        | `reports:operational`                                              |
| GET    | `/reports/:type?from=&to=&interval=&format=json\|csv`     | `reports:operational` or `reports:financial`, by type (below)      |

**Period.** `from` and `to` are inclusive gym-time dates. Without them the period is the last 30
days, today included. The longest period is 366 days. `interval` is `day` or `month`; without it,
periods up to 92 days are grouped by day and longer ones by month. Every bucket in the period is
returned, including empty ones.

**Summary.** Live cards (current members, memberships by status, today's check-ins, balances) are
always "now". The `period` block covers `from`–`to`: registrations (roles that see all members),
check-ins and denied entries (`reports:operational`) and collected, refunded and net revenue
(`reports:financial` only). Trainers get `period: null` and their own `trainer` block instead.

**Report types.**

| Type                    | Permission            | Receptionist |
| ----------------------- | --------------------- | ------------ |
| `registrations`         | `reports:operational` | —            |
| `membership-status`     | `reports:operational` | —            |
| `renewals`              | `reports:operational` | —            |
| `attendance`            | `reports:operational` | Yes          |
| `denied-access`         | `reports:operational` | Yes          |
| `class-attendance`      | `reports:operational` | —            |
| `equipment-maintenance` | `reports:operational` | —            |
| `payments`              | `reports:financial`   | —            |
| `outstanding-balances`  | `reports:financial`   | —            |
| `revenue`               | `reports:financial`   | —            |
| `trainer-performance`   | `reports:financial`   | —            |

A JSON report (`ReportDto`) has `summary` cards, an optional `series` for the chart, an optional
`breakdown`, typed `columns` and up to 5,000 `rows` (`totalRows` and `truncated` say when there
were more; the summary and chart always cover the whole period).

`format=csv` returns the same rows as `text/csv; charset=utf-8` with a UTF-8 BOM (so Excel opens
it correctly), CRLF line ends and a `Content-Disposition` filename such as
`attendance_2026-03-01_2026-03-31.csv`. Money is written in major units (`2500.00`) and instants in
gym time (`2026-03-01 18:30`). Any cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage
return is prefixed with `'`, so a spreadsheet never runs it as a formula.

### Member portal (`/me`)

| Method      | Path                                                         |
| ----------- | ------------------------------------------------------------ |
| GET · PATCH | `/me/profile` (PATCH: emergency contact only)                |
| GET · POST  | `/me/profile/photo`                                          |
| GET         | `/me/membership` · `/me/memberships`                         |
| GET         | `/me/attendance`                                             |
| GET         | `/me/invoices` · `/me/payments` · `/me/payments/:id/receipt` |
| GET         | `/me/trainers` · `/me/schedule` · `/me/class-sessions` · `/me/appointments` |
| POST        | `/me/bookings` · `/me/bookings/:id/cancel` · `/me/appointments/:id/cancel` |
| GET         | `/me/workouts` · `/me/exercises/:id/image`                   |
| GET · POST  | `/me/workout-logs` · `/me/progress`                          |

Every `/me` route is for the MEMBER role only and returns only the caller's own records. A guessed
ID that belongs to another member returns `404`.
