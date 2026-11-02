# Security

How the Gym Management System protects accounts, member data and the entrance, what was checked
in the Stage 8 security pass, and what to do before going live. Biometric data has its own
document (`BIOMETRICS.md`); notification credentials are covered in `NOTIFICATIONS.md`.

## 1. Accounts and sign-in

| Control           | Detail                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password hashing  | argon2id with the OWASP parameters (19 MiB memory, 2 iterations, 1 lane). Plain passwords are never stored or logged.                                                                                                        |
| Unknown emails    | Checked against a throwaway hash, so they take as long as a wrong password and the response is the same. Sign-in never says which part was wrong.                                                                            |
| Rate limits       | 5 failed sign-ins per 15 minutes, counted per IP **and** per account (`LOGIN_RATE_LIMIT_*`). Successful sign-ins do not count. Password changes: 10 failures per 15 minutes per user.                                        |
| Lockout           | 10 failed attempts lock the account for 15 minutes (`ACCOUNT_LOCKOUT_*`). The lockout is recorded in the audit log.                                                                                                          |
| First sign-in     | The seeded Admin and every account created by staff get a temporary password that must be changed before anything else works (`requirePasswordChanged`).                                                                     |
| Deactivation      | Deactivating a staff account ends its sessions; the next request gets 401. History is kept.                                                                                                                                  |
| Role changes      | Only the Admin can change a role, and nobody can raise their own role.                                                                                                                                                       |

## 2. Sessions, CSRF and origin

- Sessions are stored on the server. The browser holds only a random token in an `httpOnly`,
  `SameSite=Strict` cookie (`Secure` when `COOKIE_SECURE=true`); the database keeps its SHA-256
  hash, so a database copy cannot be used to sign in.
- A session lasts at most `SESSION_TTL_HOURS` (12) and ends after `SESSION_IDLE_MINUTES` (60)
  without activity.
- Every request that changes data needs the session's CSRF token in `X-CSRF-Token`
  (synchronizer token, compared in constant time).
- A request with an `Origin` other than `WEB_ORIGIN` is refused with 403 before it reaches any
  route. CORS allows that one origin only, with credentials.

## 3. Permissions

- Every API route checks the caller's permission and scope on the server (`requirePermission`
  and the per-module policies). The web app only hides what a role cannot use; it is never the
  control.
- The full route × role matrix (PLAN §5) is tested in
  `apps/server/test/integration/permission-matrix.test.ts`: allowed, 403, and 401 when signed out.
- Scoped access: a Trainer sees only assigned members; a Member sees only their own records
  through `/me`, and guessed IDs of another member's receipts or bookings return 404.
- Reports: financial reports (payments, outstanding balances, revenue, trainer performance) and
  the revenue chart are Admin and Manager only. The Receptionist gets the attendance and denied
  entry reports; the Trainer gets none.

## 4. HTTP hardening

| Area            | Setting                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headers         | `helmet()` defaults: Content-Security-Policy, HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`. `X-Powered-By` is removed.  |
| Caching         | Every `/api/v1` response sends `Cache-Control: no-store`: they carry personal, financial and access data.                                                                         |
| Body size       | JSON bodies up to 100 KB (413 above). Photo uploads up to `MAX_UPLOAD_MB` (2 MB).                                                                                                  |
| Uploads         | One file per request. The type is decided from the file's bytes (JPEG, PNG, WebP), never from its name or the browser's content type. Files get random names outside the web root. |
| Rate limits     | Sign-in and password changes (§1); entrance scans 60 per minute per device; reports, CSV exports and dashboard charts 60 per minute per user.                                       |
| Errors          | One error format (`{ error: { code, message } }`). No stack traces, SQL or internal details; an unexpected error answers 500 with a reference that matches the server log.         |
| Logs            | Request logs keep the method, path (no query string) and status. Passwords, tokens, device keys and fingerprint references are never logged.                                       |
| CSV export      | Text cells that start with `=`, `+`, `-`, `@`, tab or carriage return get a leading apostrophe, so a spreadsheet does not run them as formulas.                                   |
| Proxy           | `TRUST_PROXY` is off by default; set it only behind a known reverse proxy, otherwise rate limits could be bypassed with a forged `X-Forwarded-For`.                                 |

## 5. Data integrity

- The audit log, membership history, access attempts, attendance corrections and refunds are
  append-only: database triggers reject `UPDATE` and `DELETE`, so even a bug or a direct SQL
  session cannot rewrite history. Corrections are new rows.
- Payments are never deleted, and their receipt number, invoice, member, amount, method and
  time cannot change; only the status may move (an online payment confirmed or failed). Money
  goes back through a separate refund row.
- Invoices are never deleted (they are voided, with a required reason), their number, member,
  membership and amount cannot change, and a void invoice cannot be reopened.
- Every sensitive change (sign-ins, role and settings changes, membership and payment actions,
  access overrides, device keys) writes an audit row with the actor, time, IP and old and new
  values.
- Overlapping memberships are prevented by a database exclusion constraint, not only by code.

## 6. Entrance and devices

- Access decisions fail closed: a database error, a timeout (`ACCESS_DB_TIMEOUT_MS`) or anything
  unexpected is a denial, and a grant is never returned before it is committed.
- Each scanner authenticates with its own device key. The key is random, shown once, and stored
  only as a SHA-256 hash; it can be rotated or the device disabled from the Scanners screen.
- The fingerprint simulator is for development and demos. The server **refuses to start** with
  `BIOMETRIC_SIMULATOR_ENABLED=true` in production, and its routes return 404 when it is off.
  Simulated attempts are always stored and shown as SIMULATED.
- No fingerprint images or templates reach this system (`BIOMETRICS.md` §5).

## 7. Secrets

- All secrets live in the root `.env`, which is git-ignored. `.env.example` holds placeholders
  only. `npm run db:setup` asks for the PostgreSQL superuser password without echoing it and never
  stores it.
- Anything starting with `VITE_` is bundled into public JavaScript; never put a secret there.
- Notification credentials (SMTP, Twilio) are read from `.env` only and never returned by the
  API: the channels screen shows whether a channel is configured, not its values.

## 8. Dependency audit (Stage 8, 2026-10-26)

- `npm audit fix` updated the lockfile and cleared every high-severity finding.
- `npm audit --omit=dev`: **0 vulnerabilities** in what the server and the web app ship.
- `npm audit` still lists **4 moderate** findings, all in the development toolchain:
  `esbuild <= 0.24.2` pulled in by `drizzle-kit` (through `@esbuild-kit/*`). The advisory
  (GHSA-67mh-4wv8-2f99) affects esbuild's own development server, which this project never runs;
  `drizzle-kit` is used only to generate migrations on a developer's machine. The only offered
  fix downgrades `drizzle-kit` to 0.18 (a breaking change), so it was not applied. Re-check when
  `drizzle-kit` publishes a release without `@esbuild-kit`.

## 9. What the tests cover

| Area                                                                   | Where                                                                       |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Headers, no-store, body limits, error format, origin and CSRF checks   | `apps/server/test/integration/security.test.ts`                             |
| Sign-in limits, lockout, sessions, forced password change              | `apps/server/test/integration/auth.test.ts`                                 |
| Every route × role                                                     | `apps/server/test/integration/permission-matrix.test.ts`                    |
| Members cannot read each other's records (scenario 12)                 | `portal.test.ts` and each module's tests                                    |
| Fail-closed access decisions, device keys, simulator off in production | `access.test.ts`, `devices.test.ts`, `unit/eligibility.test.ts`, `unit/env.test.ts` |
| Append-only and protected tables                                       | `billing.test.ts`, `memberships.test.ts`, `attendance.test.ts`, `settings-audit.test.ts` |
| Report permissions, CSV formula guard, report rate limit               | `reports.test.ts`, `unit/csv.test.ts`                                       |

## 10. Production checklist

1. `NODE_ENV=production`, `COOKIE_SECURE=true`, and the site served over HTTPS only.
2. `WEB_ORIGIN` set to the exact public URL (scheme, host and port).
3. `TRUST_PROXY` set only if a reverse proxy you control sits in front of the server.
4. `BIOMETRIC_SIMULATOR_ENABLED=false` (the server will not start otherwise).
5. A strong, unique `gym_app` database password; the database not reachable from the internet.
6. The seeded Admin password changed at first sign-in, and `SEED_ADMIN_PASSWORD` removed from
   `.env` afterwards.
7. No demo data (see the README's "Demo data and production data").
8. Daily database backups, kept encrypted and tested by restoring one.
9. `UPLOAD_DIR` on a disk that is backed up and not served directly by any web server.
10. Notification channels tested with a real message before relying on them (`NOTIFICATIONS.md`
    §7); real scanners set up with the go-live checklist (`BIOMETRICS.md` §9).
11. `npm audit --omit=dev` clean, and dependencies updated at least monthly.
