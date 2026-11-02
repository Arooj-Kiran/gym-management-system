# Gym Management System

A staff dashboard and member portal for a single gym: members, memberships, fingerprint check-in
at the entrance, billing, classes, trainers, workouts, equipment, notifications and reports. It is
built in stages; see `docs/PLAN.md` for the plan and the progress table (Section 11).

> **Status:** Stages 1–8 are built: foundation, members and plans, the membership lifecycle,
> access control and attendance, billing, scheduling, workouts / equipment / notifications, and
> reports with the security, accessibility and documentation pass. The current stage gate result
> is recorded in `docs/PLAN.md` §11. Real fingerprint scanners and the email, SMS and WhatsApp
> channels need configuration before they work; until then the scanner is **SIMULATED** and the
> channels show **REQUIRES CONFIGURATION**.

## Stack

| Part      | Technology                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------- |
| Web       | React 19, Vite, TypeScript, Tailwind CSS 4, TanStack Query, React Router, Recharts                    |
| API       | Node 24, Express 5, TypeScript (run with `tsx`), Zod, pino                                            |
| Database  | PostgreSQL 17, Drizzle ORM and migrations                                                             |
| Shared    | `packages/shared`: roles, the permission matrix, enums and Zod schemas                                |
| Biometric | `apps/biometric-agent`: runs on the front-desk PC and talks to the scanner                            |
| Tests     | Vitest and Supertest (API, against a separate `_test` database), Testing Library, Playwright with axe |

```
apps/server            Express API (src/modules/<feature>, migrations in src/db/migrations)
apps/web               React app (src/features/<feature>, e2e/ for Playwright)
apps/biometric-agent   Front-desk scanner agent (simulated adapter until hardware is connected)
packages/shared        Code used by both: permissions, schemas, enums
docs/                  Requirements, rules, the plan and the guides below
```

## Local setup (Windows)

### 1. Install Node.js 24

Download the Node.js 24 LTS Windows installer (`.msi`) from <https://nodejs.org> and run it with
the defaults. In a new terminal, `node -v` should print `v24.x` and `npm -v` `11.x` or later.

### 2. Install PostgreSQL 17

1. Download the PostgreSQL 17 installer for Windows from
   <https://www.postgresql.org/download/windows/> (the EDB installer).
2. Keep these components: **PostgreSQL Server** and **Command Line Tools** (pgAdmin and Stack
   Builder are optional).
3. Choose a password for the `postgres` superuser and keep it somewhere safe. You type it once in
   step 4; the project never stores it.
4. Keep port **5432** and the default locale.
5. Add `C:\Program Files\PostgreSQL\17\bin` to your user `Path` (Start → "Edit environment
   variables for your account" → `Path` → New). In a new terminal, `psql --version` should
   print `psql (PostgreSQL) 17.x`.
6. Check that the service runs: Start → Services → `postgresql-x64-17` → Running.

> **Smart App Control:** on Windows 11 with Smart App Control on, a newly installed PostgreSQL
> extension DLL (for example `pg_trgm.dll`, used by member search) can be blocked until Windows
> has checked its reputation; migrations then fail with "could not load library". Keep Smart App
> Control on. The block usually clears on its own after Windows updates its reputation data; if
> it does not, run PostgreSQL on another machine or a cloud test database and point
> `DATABASE_URL` / `TEST_DATABASE_URL` at it.

### 3. Install and run the app

```bash
npm install
npm run db:setup     # interactive: asks for the postgres superuser password (hidden, never stored),
                     # creates the gym_app role and the gym_dev and gym_test databases, and writes .env
npm run db:migrate   # applies migrations to gym_dev
npm run db:seed      # creates the first Admin; you must change this password at first sign-in
npm run dev          # API on http://localhost:4000, web on http://localhost:5173
```

Sign in at <http://localhost:5173> with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env`,
then choose a new password. `GET http://localhost:4000/api/v1/health/ready` answers
`{"status":"ready","database":"ok"}` when the API can reach the database.

All configuration lives in the root `.env`; `.env.example` lists every variable with placeholder
values. `.env` is git-ignored, so never commit it.

### 4. For the end-to-end tests

```bash
npm exec -w @gms/web -- playwright install chromium   # once: the browser Playwright drives
npm run test:e2e
```

## Commands

| Command                              | What it does                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                        | API and web together, with reload                                                                                |
| `npm run build` · `npm start`        | Build the web app, then run the API, which also serves the built app (production)                                |
| `npm run agent`                      | Start the biometric agent on the front-desk PC (`AGENT_*` variables; see `docs/BIOMETRICS.md`)                   |
| `npm run lint` · `npm run typecheck` | ESLint and TypeScript for every workspace                                                                        |
| `npm run format` · `format:check`    | Prettier: rewrite, or only check                                                                                 |
| `npm test`                           | Unit and integration tests (shared, server, web, agent); everything except E2E                                   |
| `npm run test:e2e`                   | Playwright: every acceptance flow, keyboard-only use, 360 / 768 / 1280 px layouts and an axe scan on each screen |
| `npm run test:all`                   | `npm test`, then `npm run test:e2e`                                                                              |
| `npm run db:setup`                   | Create the database role, `gym_dev` and `gym_test`, and write `.env`                                             |
| `npm run db:migrate`                 | Apply migrations to the database in `DATABASE_URL`                                                               |
| `npm run db:seed`                    | Create the first Admin (only if no Admin exists)                                                                 |
| `npm run db:seed:demo`               | Add fictional demo data (refused in production; see below)                                                       |
| `npm run db:generate`                | Generate a migration after a schema change                                                                       |

Tests run only against a database whose name ends in `_test`. They reset that database
themselves and refuse to touch any other. Do not run `npm test` and `npm run test:e2e` at the same
time: both use `gym_test`.

## Demo data and production data

|                    | Demo                                                                                                           | Production                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Database           | `gym_dev` (or any non-production database)                                                                     | Its own database, created fresh; never a copy of `gym_dev`                            |
| Seed               | `npm run db:seed`, then `npm run db:seed:demo`                                                                 | `npm run db:seed` only                                                                |
| What you get       | Fictional members, plans, memberships, scans, invoices, payments and classes. No real people, no portal logins | One Admin account with a password that must be changed at first sign-in. Nothing else |
| How you can tell   | Demo members are flagged `is_demo`, and every staff screen shows a **DEMO DATA** banner                        | No banner                                                                             |
| Fingerprint reader | `BIOMETRIC_SIMULATOR_ENABLED=true`: simulated scans, labelled SIMULATED everywhere                             | `false` (required: the server will not start otherwise); a real scanner and the agent |
| Notifications      | Channels may stay unconfigured: in-app notifications work and external sends are recorded as not configured    | Configure and test each channel you rely on (`docs/NOTIFICATIONS.md`)                 |

- `db:seed:demo` refuses to run when `NODE_ENV=production`, and running it twice adds nothing.
- There is no "remove demo data" button: demo records take part in history (payments,
  attendance, audit) that is append-only by design. To go live, start from a **new, empty
  database** (`db:migrate`, then `db:seed`) instead of cleaning a demo one.
- Real member data never belongs in `gym_dev` or `gym_test`, in screenshots, or in bug reports.

## Documentation

| Document                                         | Contents                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| [`docs/requirements.md`](docs/requirements.md)   | What the gym asked for                                                      |
| [`docs/PLAN.md`](docs/PLAN.md)                   | Architecture, data model, permission matrix, stages and progress            |
| [`docs/RULES.md`](docs/RULES.md)                 | Working rules for this project                                              |
| [`docs/API.md`](docs/API.md)                     | Every API route: conventions, errors, rate limits, permissions              |
| [`docs/SECURITY.md`](docs/SECURITY.md)           | Security controls, the dependency audit and the production checklist        |
| [`docs/BIOMETRICS.md`](docs/BIOMETRICS.md)       | Fingerprint check-in: hardware, setup, stored data, consent, go-live checks |
| [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md) | Reminders and messages: types, schedule, channels and their configuration   |

## Security in brief

- Passwords are hashed with argon2id. Sessions are server-side, in httpOnly SameSite=Strict
  cookies, with CSRF tokens and origin checks on every change.
- Login has rate limits and an account lockout. Every sensitive change is written to an
  append-only audit log.
- Permissions are enforced by the API on every route. The web app only hides what a role
  cannot use.
- Access decisions fail closed: if a membership cannot be verified, entry is denied.

Details and the production checklist: [`docs/SECURITY.md`](docs/SECURITY.md).
