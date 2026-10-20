import type { AccessReason } from './enums';

/**
 * Access-control rules shared by the server (which decides) and the web kiosk (which only
 * displays). PLAN §6.4–§6.6.
 */

/** Simulated devices only ever use fake refs with this prefix (PLAN §3.6). */
export const SIM_REF_PREFIX = 'SIM-';

/** Reserved by the simulator fixtures as "a fingerprint nobody is enrolled with". */
export const SIM_UNENROLLED_REF = 'SIM-9999';

export const isSimulatedRef = (ref: string) => ref.startsWith(SIM_REF_PREFIX);

/**
 * template_ref is sensitive (PLAN §6.6): API responses only ever show the last two characters,
 * e.g. `SIM-0001` → `SIM-••01`, device PIN `1042` → `••42`.
 */
export function maskTemplateRef(ref: string | null): string | null {
  if (ref === null) return null;
  const prefix = isSimulatedRef(ref) ? SIM_REF_PREFIX : '';
  const rest = ref.slice(prefix.length);
  const visible = rest.length > 2 ? rest.slice(-2) : '';
  return `${prefix}••${visible}`;
}

export const KIOSK_IDLE_PROMPT = 'Place your thumb on the scanner';
/** The kiosk returns to the idle prompt this long after showing a result. */
export const KIOSK_RESET_MS = 5_000;
export const SIMULATED_BANNER = 'SIMULATED SCANNER — not real biometric verification';

export interface KioskMessage {
  title: string;
  message: string;
}

function formatKioskDate(isoDate: string | null | undefined): string {
  if (!isoDate) return 'the end date';
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

/** What the entrance screen shows. Never balances or other private details (PLAN §6.3). */
export function kioskMessage(
  reason: AccessReason,
  context: { firstName?: string | null; endDate?: string | null } = {},
): KioskMessage {
  const denied = (message: string) => ({ title: 'Access Denied', message });
  switch (reason) {
    case 'GRANTED': {
      const welcome = context.firstName ? `Welcome, ${context.firstName}.` : 'Welcome.';
      const until = context.endDate ? ` Valid until ${formatKioskDate(context.endDate)}.` : '';
      return { title: 'Access Granted', message: `${welcome}${until}` };
    }
    case 'MEMBERSHIP_CANCELLED':
      return denied('Membership cancelled. Please see reception.');
    case 'MEMBERSHIP_EXPIRED':
      return denied(`Membership expired on ${formatKioskDate(context.endDate)}.`);
    case 'MEMBERSHIP_SUSPENDED':
      return denied('Membership suspended.');
    case 'MEMBERSHIP_NOT_ACTIVATED':
    case 'MEMBERSHIP_NOT_STARTED':
    case 'NO_MEMBERSHIP':
      return denied('No active membership for today.');
    case 'MEMBER_INACTIVE':
    case 'ACCESS_BLOCKED':
      return denied('Please see reception.');
    case 'OUTSIDE_ACCESS_HOURS':
      return denied('Your plan does not include entry at this time.');
    case 'MEMBER_NOT_RECOGNIZED':
      return {
        title: 'Member Not Recognized',
        message: 'Please try again or see reception.',
      };
    case 'SCANNER_UNAVAILABLE':
      return denied('Scanner unavailable. Please see reception.');
    case 'AUTHORIZATION_UNAVAILABLE':
      return denied('Membership could not be verified. Please see reception.');
    case 'DEVICE_NOT_AUTHORIZED':
      return denied('Device not authorized.');
  }
}

/**
 * The consent a member gives before a fingerprint is enrolled (PLAN §6.6). The server stores
 * the version and the SHA-256 of this exact text; changing the text needs a new version.
 */
export const BIOMETRIC_CONSENT = {
  version: '2026-10-v1',
  text: [
    'I agree that the gym may enroll my fingerprint on its entrance scanner so that I can check in.',
    'The scanner keeps the fingerprint template on the device itself. The gym stores only a device user number, never an image of my fingerprint.',
    'The fingerprint is used only to check my membership at the entrance.',
    'I can withdraw this consent at any time at reception. My fingerprint will then be deleted from the scanner and I can check in with staff instead.',
    'If I stop being a member, my fingerprint will be deleted after the retention period set by the gym.',
  ].join('\n'),
} as const;
