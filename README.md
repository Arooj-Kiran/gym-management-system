# Gym Management System

A staff dashboard and member portal for a single gym: members, memberships, access control,
billing, classes, trainers and reports. It is built in stages; see `docs/PLAN.md` for the plan
and the progress table (Section 11).

> **Status:** Stage 1 (Foundation) is done: sign-in, staff accounts, roles, settings and the
> audit log. Member, access, billing and class features arrive in later stages.

## Stack

| Part     | Technology                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Web      | React 19, Vite, TypeScript, Tailwind CSS 4, TanStack Query, React Router                              |
| API      | Node 24, Express 5, TypeScript (run with `tsx`), Zod, pino                                            |
| Database | PostgreSQL 17, Drizzle ORM and migrations                                                             |
| Shared   | `packages/shared`: roles, the permission matrix, enums and Zod schemas                                |
| Tests    | Vitest and Supertest (API, against a separate `_test` database), Testing Library, Playwright with axe |

```
apps/server     Express API (src/modules/<feature>, migrations in src/db/migrations)
apps/web        React app (src/features/<feature>, e2e/ for Playwright)
packages/shared Code used by both: permissions, schemas, enums
docs/           Requirements, rules and the plan
```

## Local setup (Windows)

Prerequisites: Node 24+, npm 11+, and PostgreSQL 17 running locally with `psql` on the PATH.

```bash
npm install
npm run db:setup     # interactive: asks for the postgres superuser password (hidden, never stored),
                     # creates the gym_app role and the gym_dev and gym_test databases, and writes .env
npm run db:migrate   # applies migrations to gym_dev
npm run db:seed      # creates the first Admin; you must change this password at first sign-in
npm run dev          # API on http://localhost:4000, web on http://localhost:5173
```

All configuration lives in the root `.env`; `.env.example` lists every variable with placeholder
values. `.env` is git-ignored, so never commit it.

## Commands

| Command                              | What it does                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `npm run dev`                        | API and web together, with reload                                                                          |
| `npm run lint` · `npm run typecheck` | ESLint and TypeScript for every workspace                                                                  |
| `npm test`                           | Unit and integration tests (shared, server, web); everything except E2E                                    |
| `npm run test:e2e`                   | Playwright: login flows, role navigation, responsive checks at 360 / 768 / 1280 px, axe accessibility scan |
| `npm run test:all`                   | `npm test`, then `npm run test:e2e`                                                                        |
| `npm run db:generate`                | Generate a migration after a schema change                                                                 |

Tests run only against a database whose name ends in `_test`. They reset that database
themselves and refuse to touch any other.

## Security notes

- Passwords are hashed with argon2id. Sessions are server-side, in httpOnly SameSite=Strict
  cookies, with CSRF tokens and origin checks on every change.
- Login has rate limits and an account lockout. Every sensitive change is written to an
  append-only audit log.
- Permissions are enforced by the API on every route. The web app only hides what a role
  cannot use.
