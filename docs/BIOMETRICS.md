# Biometric check-in

> **Status: SIMULATED.** No fingerprint hardware has been connected to or tested with this
> system. Every scan so far comes from the simulated scanner (the panel on the check-in desk, or
> the agent's simulated adapter). Nothing here is real biometric verification until a scanner is
> chosen, connected and tested. Screens driven by a simulated scanner always show
> **"SIMULATED SCANNER — not real biometric verification"**.

This document covers the hardware options and the questions to ask a vendor, how a scanner is set
up, what data is stored, the consent text, and how fingerprints are retained and deleted. The
design behind it is in [PLAN.md §6](PLAN.md#6-biometric-integration-design); the rules it must
follow are in [RULES.md §4–§5](RULES.md).

## 1. How a check-in is decided

A recognised fingerprint only tells the system **who** is at the door. It never lets anyone in by
itself.

1. The scanner identifies a finger and reports its **device user ID** (for example `1042`, or
   `SIM-0001` on a simulated scanner) to the biometric agent on the front-desk PC.
2. The agent sends that ID to the server, signed with the scanner's own key.
3. The server looks up the member and checks their membership **from the database, at that
   moment**: status, start and end dates (in gym time), access days and hours, account status and
   any access block.
4. Only after the attempt and attendance rows are committed does the server answer `GRANTED`.
   Anything else — an error, a timeout, a malformed answer, no answer — is a denial.
5. Every attempt, granted or denied, is logged with time, member (if known), result, reason,
   scanner and source. The entrance screen shows the result and returns to
   "Place your thumb on the scanner" after 5 seconds.

Nothing about memberships is cached on the agent or in the browser. Checking out never makes a
later scan eligible. Staff can check a member in by hand (manual check-in); it runs the same
membership check, needs a reason and is written to the audit log.

## 2. Hardware options

A browser cannot talk to fingerprint hardware, and vendor SDKs are native (mostly Windows)
libraries. Every real option therefore runs through the local **biometric agent**
(`apps/biometric-agent`).

| Option | Examples (confirm current models and licences with the vendor) | Where matching happens | Verdict |
|---|---|---|---|
| **A. Networked access terminal** (recommended) | ZKTeco access terminals (K40, MB series), Suprema BioEntry / BioStation, Anviz | On the terminal. Templates never leave it. | Best for privacy. Must be set to **identify-only, no relay** (see §4). |
| B. USB desktop reader | HID DigitalPersona U.are.U 4500/5300, SecuGen Hamster Pro 20, Suprema BioMini | On the front-desk PC | Cheaper, but templates would have to be stored on the PC, encrypted. Needs a schema change and approval first. |
| C. WebAuthn / Windows Hello / phone fingerprint | — | Per personal device | **Not suitable.** It cannot identify hundreds of members at a shared entrance. |

Only a **simulated adapter** exists today. A vendor adapter is written once a device is chosen;
that is a new dependency and needs approval.

## 3. Questions for the vendor before buying

- Which operating systems and SDK languages are supported? Is there a push protocol or only polling?
- What does the SDK licence cost, per PC or per device?
- **Can automatic door opening be switched off** so the terminal only identifies (no relay on match)?
- How is an identified user reported (event type, latency, push or pull)? Does it include a stable user ID?
- Can templates be **deleted remotely** through the API, and is deletion confirmed?
- Does the device ever export **raw fingerprint images**? Can that be disabled?
- How does the device keep its clock in sync?
- What happens when the device is tampered with, loses power or loses the network?
- Can enrollment be started from the API, or only on the device's own screen?

## 4. Setting up a scanner

1. **Add the scanner** (Admin): *Administration → Scanners → Add scanner*. Choose
   **Real scanner**, enter its name and location, and optionally vendor, model and serial
   number. The device key is shown **once**. Copy it straight into the agent's environment
   (step 3). If it is lost, use *Rotate key*: the old key stops working immediately.
2. **Configure the terminal** (option A): enroll fingers on the terminal itself, and set it to
   **identify-only with the relay / door output disabled**. The door or turnstile may only be
   opened by the agent after the server answers `GRANTED`.
3. **Configure the agent** on the front-desk PC. It reads these variables from the environment
   or the repository `.env` (never commit real values; the key is a secret):

   | Variable | Value |
   |---|---|
   | `AGENT_BACKEND_URL` | The server's API URL, e.g. `https://gym.example.com/api/v1` (HTTPS in production) |
   | `AGENT_DEVICE_ID` | The scanner's ID, shown in the key dialog |
   | `AGENT_DEVICE_KEY` | The device key from the key dialog |
   | `AGENT_ADAPTER` | `simulated` (the only adapter until hardware is chosen) |
   | `AGENT_REQUEST_TIMEOUT_MS` | Default `3000`. No answer in time → denied. |
   | `AGENT_OUTBOX_PATH` | Default `./data/outbox.jsonl`. Denials recorded while the server was unreachable. |
   | `AGENT_HEARTBEAT_SECONDS` | Default `30`. Health reports and pending deletions. |

   Start it with `npm run start -w @gms/biometric-agent`. The agent only makes outgoing
   requests; it opens no ports. Its error messages name a bad variable but never print its value.
4. **Enroll members** (Admin or Manager): on the member's page, *Fingerprint → Record consent*,
   then *Enroll fingerprint*, choose the scanner and type the **device user ID** the terminal
   shows for that member.
5. **Check it**: *Administration → Scanners* shows when the scanner was last seen and its health.
   The *Check-in desk* and the *Full-screen kiosk* show each decision live.

### Testing without hardware

With `BIOMETRIC_SIMULATOR_ENABLED=true` (refused when `NODE_ENV=production`), add a
**Simulated** scanner and use the simulated-scanner panel on the *Check-in desk*. Members enrolled
on a simulated scanner get fake `SIM-` IDs; the panel also has failure cases (unknown
fingerprint, scanner error, server cannot verify). `npm run db:seed:demo` creates a simulated
scanner and fictional members for every case. The agent's simulated adapter is driven from its
console (`scan SIM-0001`, `nomatch`, `error`, `health error`, `help`).

## 5. What is stored (data inventory)

| Data | Where | Notes |
|---|---|---|
| Fingerprint image or template | **Nowhere in this system.** Templates stay on the terminal (option A). | Raw images are never received, stored or logged. |
| Device user ID (`template_ref`) | `biometric_enrollments` | The only link between a member and the terminal; useless without the terminal. Never logged, never exported, shown only masked (`••42`, `SIM-••01`). Erased once the terminal confirms deletion. |
| Consent | `biometric_consents` | Text version, SHA-256 of the exact text, time, the staff member who recorded it, and when and by whom it was withdrawn. |
| Enrollment history | `biometric_enrollments` | Scanner, status (Active / Deletion pending / Deleted), who enrolled or revoked and why. |
| Access attempts | `access_attempts` (append-only) | Time, scanner, source (Real / Simulated / Manual), member if recognised, result and reason. |
| Attendance | `attendance_records` | One row per granted entry; corrections are kept in `attendance_corrections`. |
| Scanner credentials | `access_devices` | Only a hash of the device key. |
| Agent outbox | Front-desk PC, `AGENT_OUTBOX_PATH` | Denial facts only (time, event ID). No membership data. |
| Audit log | `audit_logs` | Consent, enrollment, revocation, deletion, manual check-in, scanner changes. Device user IDs appear masked. |

## 6. Consent

Consent must be recorded **before** a fingerprint can be enrolled, by an Admin or Manager, after
the member has read the text (or had it read to them). Members who do not consent check in at the
front desk instead.

Current text, version **`2026-10-v1`** (the source is `BIOMETRIC_CONSENT` in
`packages/shared/src/access.ts`; changing the wording requires a new version):

> - I agree that the gym may enroll my fingerprint on its entrance scanner so that I can check in.
> - The scanner keeps the fingerprint template on the device itself. The gym stores only a device
>   user number, never an image of my fingerprint.
> - The fingerprint is used only to check my membership at the entrance.
> - I can withdraw this consent at any time at reception. My fingerprint will then be deleted from
>   the scanner and I can check in with staff instead.
> - If I stop being a member, my fingerprint will be deleted after the retention period set by the
>   gym.

**Withdrawing consent** (Admin or Manager, reason required) revokes every enrollment of that
member at once.

## 7. Retention and deletion

**Deleting a fingerprint** (on request, after consent is withdrawn, or when no longer needed):

1. An Admin or Manager revokes the enrollment on the member's page (reason required). From that
   moment the fingerprint is no longer recognised: a scan gives "Member Not Recognized".
2. The enrollment shows **Deletion pending**. On its next heartbeat the agent receives the
   deletion and removes the template from the terminal.
3. When the agent confirms, the enrollment becomes **Deleted** and the device user ID is erased.
   Each step is written to the audit log.

With only the simulated adapter, step 2 is simulated. Real terminals must support remote deletion
(see the vendor questions); otherwise the template must be deleted on the terminal by hand and
the vendor adapter must confirm it.

**Retention period:** the gym setting `biometric_retention_days` (default 30) is the agreed time
after which fingerprints of members who are archived, or have had no active membership, should
be deleted. **The automatic daily job that flags these enrollments is not built yet**; until it
is, an Admin or Manager should review such members and revoke their fingerprints by hand.

## 8. Legal review

Fingerprints are biometric data, which many jurisdictions treat as a special category (for
example GDPR Article 9, or national data-protection laws). Before real scanners are used, the
gym's legal adviser should review the consent text, the retention period, the data inventory
above, and whether a data-protection impact assessment is required. This document is not legal
advice.
