# Project Rules — Gym Management System

These rules apply to EVERY stage and EVERY session of this project.
If anything in docs/requirements.md seems to conflict with these rules, follow these rules and ask me.

---

## 0. Priority Order

1. Security and the biometric membership authorization rule
2. Correctness (tested, working code)
3. These rules
4. docs/PLAN.md (approved plan)
5. docs/requirements.md (feature list)
6. Speed and convenience (lowest priority)

---

## 1. Start of Every Session

- Read docs/requirements.md, docs/PLAN.md and docs/RULES.md before doing anything.
- Tell me which stage we are on, what is done, and what is next.
- Do not write code until I confirm the current task.

---

## 2. Stage-by-Stage Workflow

- Work on ONLY ONE stage at a time, exactly as defined in docs/PLAN.md.
- Never start the next stage on your own, even if the current one finishes early.
- Never add features that belong to a later stage.
- At the end of every stage:
  1. Run the application and confirm it starts without errors.
  2. Run ALL automated tests (not only the new ones). Fix every failure.
  3. Update the "Progress" section of docs/PLAN.md.
  4. STOP and send me the Stage Report (format in Section 13).
  5. Wait until I reply "approved, continue".

---

## 3. Honesty and Verification

- Never claim something works unless you actually ran it or tested it.
- Clearly separate: "Implemented and tested" / "Implemented but NOT tested" / "Not implemented".
- If a test fails or a command errors, report it honestly. Never hide or skip failures.
- Never weaken, skip, or delete a test just to make it pass.
- If you are unsure about something, ask me instead of guessing.

---

## 4. Biometric Access Control — NON-NEGOTIABLE

- A fingerprint match ONLY identifies a member. It NEVER grants access by itself.
- Every check-in must be authorized by the backend using CURRENT membership data from the database at the moment of the scan.
- Entry is allowed ONLY when ALL of these are true:
  - Member is found and the member account is active
  - Membership status is Active
  - Today is between the membership start date and expiry date
  - No access restriction applies
- Cancelled, Expired, or Suspended → always "Access Denied" with the reason.
- Unknown fingerprint → "Member Not Recognized".
- Scanner, network, database, or authorization service unavailable → DENY (fail closed). Never grant by default.
- A cancellation must take effect immediately for the very next scan.
- Never cache membership eligibility in the browser, the frontend, the scanner, or a local service.
- A check-out must never be treated as proof of eligibility for a new entry.
- Log EVERY attempt (granted and denied) with timestamp, member (if identified), result, reason, device, and source (SIMULATED or REAL).
- Prevent duplicate check-ins caused by repeated scanner events (use a short duplicate-scan window).
- Manual verification is allowed only for authorized staff, must still check membership on the backend, and must be audit-logged.

---

## 5. Biometric Privacy

- Never store raw fingerprint images.
- Prefer device-side matching. Store only the minimum identification reference (e.g. device template ID).
- If any template data must be stored, it must be encrypted and never logged or returned by the API.
- Biometric enrollment and deletion only by authorized roles, with audit logs.
- Record member consent before enrollment. Support deletion of biometric data on request.
- The simulated scanner must use fake test IDs only — never real biometric data.

---

## 6. Authorization and Security

- ALL permissions are enforced on the backend. Frontend hiding of buttons is only for user experience.
- Roles: Admin, Manager, Receptionist, Trainer, Member — follow the role-permission matrix in docs/PLAN.md exactly.
- Members can access ONLY their own data. Trainers see only their assigned members and the data needed for their role.
- Members can never change their own membership status, payments, or permissions.
- Passwords must be hashed with a strong algorithm (bcrypt or argon2).
- Use secure sessions or httpOnly, secure, sameSite cookies for tokens. Never store auth tokens in localStorage.
- Validate and sanitize ALL input on the server.
- Apply rate limiting on login, check-in, and other sensitive endpoints.
- Use security headers, CORS restrictions, and protection against injection, XSS, and CSRF.
- Error messages shown to users must never expose stack traces, queries, or private data.
- Audit-log every sensitive action: membership status changes, payments, refunds, attendance corrections, role/permission changes, biometric enrollment/deletion, and staff account changes.

---

## 7. Data Integrity

- Membership status, validity, payment amounts, and balances are calculated and validated on the backend only.
- Never delete payment, attendance, access-attempt, membership-history, or audit records. Use status changes or soft-deletes.
- Cancelling or renewing a membership must preserve all previous payment and attendance history.
- Every membership change creates a history record (who, what, when, old value, new value, reason).
- Use database transactions where several records must change together.
- Prevent duplicate members, duplicate bookings, and conflicting appointments.

---

## 8. External Integrations — Never Fake Them

- Label clearly in the UI, code, and docs:
  - SIMULATED — fingerprint scanner (until real hardware is connected and tested)
  - REQUIRES CONFIGURATION — online payment provider, email, SMS, WhatsApp (until real credentials are set and tested)
- Never mark an online payment as successful without verified confirmation from the payment provider.
- Never describe a simulated scan as real biometric verification.

---

## 9. Change Control — Ask Me First

Ask for my approval BEFORE:
- Changing the tech stack or architecture
- Adding a major dependency
- Changing an approved database schema
- Deleting or renaming files or folders
- Changing the role-permission matrix
- Changing any rule in this file

---

## 10. Secrets and Environment

- Keep all secrets in .env only. Never hardcode passwords, keys, or connection strings.
- Keep .env.example up to date with placeholder values only.
- Make sure .env is listed in .gitignore.
- Never print secrets in logs, test output, or reports.

---

## 11. Code Quality

- Clean, organized folder structure as defined in docs/PLAN.md.
- Reusable components. No single oversized file containing large parts of the app.
- Consistent naming conventions and formatting.
- Separate routes, controllers, services, models, and validation on the backend.
- No dead code, unused files, or commented-out blocks left behind.
- Short comments only where the logic is not obvious (especially authorization rules).

---

## 12. UI and UX

- Every visible button, link, form, search, filter, and table action must actually work. No placeholder UI.
- Every data screen needs loading, empty, error, and success states.
- Sensitive actions (cancel, suspend, refund, delete, role change) need confirmation dialogs.
- Use toast notifications for success and errors.
- Responsive on mobile, tablet, and desktop. Accessible labels and keyboard navigation.
- Consistent design system: dark navy/charcoal surfaces, white content areas, blue/green accents.
- Demo/sample data must be fictional and clearly marked as demo data.

---

## 13. Testing

- Write automated tests for every critical backend rule, especially authorization and check-in.
- The test scenarios in Section 19 of docs/requirements.md must all be covered by the end of the project.
- Biometric tests must include: active (granted), cancelled right after being active (denied immediately), expired, suspended, unknown fingerprint, scanner unavailable, and authorization unavailable.
- Use a separate test database. Tests must never touch development or production data.
- All tests must pass before a stage is reported as complete.

---

## 14. Stage Report Format

At the end of every stage, report exactly:

1. Stage name and summary
2. What was built
3. Files created / changed
4. Tests run and actual results (number passed / failed)
5. Implemented but NOT tested
6. Not done yet / known issues
7. Anything SIMULATED or REQUIRES CONFIGURATION
8. Exact commands for me to run and verify it myself
9. Suggested Git commit message

Then STOP and wait for "approved, continue".