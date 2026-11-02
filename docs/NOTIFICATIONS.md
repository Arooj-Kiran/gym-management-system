# Notifications

This document covers how the Gym Management System notifies people (requirements §12, PLAN §3.11),
which channels work out of the box and which need external credentials.

## 1. What works and what needs configuration

| Channel | Status without setup | What it needs | Provider |
|---|---|---|---|
| **In-app** (bell, `/notifications` page) | **Works.** Always on | Nothing | Built in |
| **Email** | **Requires configuration.** Recorded as `NOT_CONFIGURED` | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (`SMTP_PORT` defaults to 587) | Any SMTP server, via nodemailer |
| **SMS** | **Requires configuration.** Recorded as `NOT_CONFIGURED` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` | Twilio REST API (plain `fetch`, no SDK) |
| **WhatsApp** | **Requires configuration.** Recorded as `NOT_CONFIGURED` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | Twilio WhatsApp (an approved sender is needed) |

None of the external channels has been tested against a real provider, because no credentials
have been supplied. The automated tests use fake adapters and make **no network calls**.

Admins and Managers can see the live state of each channel on the **Notification channels**
page (in the navigation, after Settings), which reads `GET /api/v1/notifications/channels`
(permission `settings:read`). For each channel it shows:
- whether the channel is configured;
- the names of any missing variables (names only, never values);
- delivery counts for the last 7 days (sent, failed, not configured).

## 2. Turning on a channel

1. Put the variables in the server's `.env` file. Never put them in `.env.example` or in git.
   `.env.example` lists the names with empty values.
2. Restart the API. Configuration is read once, at start-up.
3. Open the **Notification channels** page and check that the channel shows **Configured**.

Notes:
- **Email.** Port 465 uses implicit TLS; any other port uses STARTTLS. Messages are plain text,
  with the subject "<title> — <gym name>". They go to the recipient's login email address.
- **SMS.** The body is "<gym name>: <title>. <body>", cut to 320 characters (one or two
  segments). It goes to the member's `phone_e164`, or else the user's phone, in E.164 form
  (for example `+923001234567`).
- **WhatsApp.** Uses the same number, prefixed `whatsapp:`. `TWILIO_WHATSAPP_FROM` must be a
  WhatsApp-enabled Twilio sender. Business-initiated messages outside the 24-hour window may need
  approved templates; this is a Twilio and Meta account setting, not something the app handles.

## 3. Notification types

Every notification goes to one user account, as an in-app row. Its `dedupe_key` is unique and
always ends with the recipient's user id, so a reminder can never be created twice for the same
person, however often the jobs run. Members **without a portal login** do not receive
notifications.

### Time-based reminders (`jobs/notification-reminders.ts`)

| Type | When | Recipient | Dedupe key (plus `:recipient`) |
|---|---|---|---|
| `MEMBERSHIP_EXPIRING` | An ACTIVE membership ends within **Settings → expiry reminder days** (default 7), and there is no later PENDING or ACTIVE renewal | The member | `MEMBERSHIP_EXPIRING:{membershipId}:{endDate}` |
| `PAYMENT_DUE` | An invoice that is PENDING, PARTIALLY_PAID or OVERDUE, with a balance above 0, is due within **payment due reminder days** (default 3) | The member | `PAYMENT_DUE:{invoiceId}:{dueDate}` |
| `PAYMENT_OVERDUE` | The same kind of invoice, already past its due date | The member | `PAYMENT_OVERDUE:{invoiceId}:{dueDate}` |
| `CLASS_REMINDER` | A BOOKED booking on a SCHEDULED session that starts within 24 hours | The member | `CLASS_REMINDER:{bookingId}:{startsAt}` |
| `APPOINTMENT_REMINDER` | A BOOKED appointment that starts within 24 hours | The member and the trainer | `APPOINTMENT_REMINDER:{appointmentId}:{startsAt}` |
| `EQUIPMENT_MAINTENANCE_DUE` | A non-retired item whose next maintenance date is within 7 days, or already past | Every active Admin and Manager | `EQUIPMENT_MAINTENANCE_DUE:{equipmentId}:{nextDate}` |
| `BIOMETRIC_RETENTION_DUE` | A member with a live (ACTIVE) fingerprint enrollment was archived, or has had no PENDING, ACTIVE or SUSPENDED membership, for **biometric retention days** (default 30). See `docs/BIOMETRICS.md` §7 | Every active Admin and Manager | `BIOMETRIC_RETENTION_DUE:{memberId}:{ARCHIVED or NO_MEMBERSHIP}:{since}` |

The date or start time is part of the key on purpose:
- an extended membership, a moved due date or a rescheduled session gets a fresh reminder;
- an unchanged one is never repeated.

### Event notifications (`modules/notifications/membership-events.ts`)

These are created inside the same database transaction as the membership change (`recordChange`),
so a notification exists only if the change was saved.

| Membership event | Type | Dedupe key (plus `:recipient`) |
|---|---|---|
| Expired (by the nightly job) | `MEMBERSHIP_EXPIRED` | `MEMBERSHIP_EXPIRED:{eventId}` |
| Cancelled | `MEMBERSHIP_CANCELLED` | `MEMBERSHIP_CANCELLED:{eventId}` |
| Suspended | `MEMBERSHIP_SUSPENDED` | `MEMBERSHIP_SUSPENDED:{eventId}` |
| Renewed | `RENEWAL_SUCCESS` | `RENEWAL_SUCCESS:{eventId}` |

Archived members are not notified.

The retention review names the member (Admins and Managers may see them) and links to the
member's page, where the fingerprint is revoked. The job never revokes or deletes anything
itself; a person confirms every deletion.

## 4. Schedule

All jobs run inside the API process (`node-cron`, gym time zone). Each job takes a PostgreSQL
advisory lock, so if several API processes run, only one of them does the work.

| Job | Cron | What it does |
|---|---|---|
| Membership expiry | `5 0 * * *` (00:05 daily) | Expires memberships; creates `MEMBERSHIP_EXPIRED` |
| Overdue invoices | `10 0 * * *` (00:10 daily) | Marks unpaid invoices that are past due as OVERDUE |
| Reminders | `15 * * * *` (hourly at :15) | Creates the time-based reminders in §3 |
| Dispatch | `* * * * *` (every minute) | Sends new notifications out over email, SMS and WhatsApp |

## 5. Delivery (`jobs/dispatch-notifications.ts`)

Each run picks up to 20 notifications that are:
- less than 48 hours old;
- not yet delivered to any channel.

Older ones stay in-app only, so nobody receives a stale reminder. Each notification gets **one
attempt per channel**, and each attempt is recorded in `notification_deliveries`:

| Outcome | Status | `error_code` |
|---|---|---|
| The channel's variables are missing | `NOT_CONFIGURED` | none; nothing leaves the server |
| The recipient is a demo account (seeded sample data) | `FAILED` | `DEMO_RECIPIENT`; demo people are never messaged |
| No email address or phone number | `FAILED` | `NO_EMAIL_ADDRESS` / `NO_PHONE_NUMBER` |
| The provider accepted the message | `SENT` | none; the provider's message id is stored |
| The provider refused it, or timed out after 10 s | `FAILED` | for example `TWILIO_21211`, `HTTP_401`, `SMTP_EAUTH`, `TIMEOUT` |

Error codes are short and never contain message text, addresses or credentials. Failed
deliveries are not retried automatically.

## 6. In-app behaviour

- **The bell** is in the sidebar header, and in the top bar on small screens. It shows the unread
  count, capped at "99+", the latest notifications and **Mark all read**.
- **Opening a notification** marks it read and goes to what it is about:
  - for members: their membership, payments or schedule page;
  - for staff: the session, the equipment item, or the memberships, invoices or appointments
    list.
- **The `/notifications` page** lists everything. It has an All / Unread filter, a mark-as-read
  button on each item, and **Mark all as read**.
- **Privacy.** Every role sees only its own notifications (`notifications:read`, own). Someone
  else's notification id returns 404.

## 7. Before relying on a channel in production

Each external channel stays **REQUIRES CONFIGURATION** until it has been checked end to end with
the gym's own account:

1. Set the variables (§2) and restart the API; the channel page shows **Configured**.
2. Give a real staff or member account (not a demo person) a notification, for example by
   suspending and reactivating a test membership, and wait for the next dispatch run (one minute).
3. Confirm the message arrived, and that the channel page counts it as **sent**. A `FAILED`
   delivery shows its `error_code` (for example `HTTP_401` for wrong Twilio credentials).
4. Only then tell members that the channel is in use.

The routes are listed in `docs/API.md` (Workouts, equipment and notifications).
