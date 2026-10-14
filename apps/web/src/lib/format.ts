/** Display formatting in the gym's timezone (Asia/Karachi by default, supplied by settings). */
const DEFAULT_TZ = 'Asia/Karachi';

export function formatDateTime(iso: string | null | undefined, timeZone = DEFAULT_TZ) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** A calendar date stored as YYYY-MM-DD, shown without any timezone shift. */
export function formatDate(isoDate: string | null | undefined) {
  if (!isoDate) return '—';
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

export function formatRelative(iso: string | null | undefined) {
  if (!iso) return 'Never';
  const diffSeconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, seconds] of steps) {
    if (Math.abs(diffSeconds) >= seconds)
      return rtf.format(Math.round(diffSeconds / seconds), unit);
  }
  return 'Just now';
}

export function formatPhone(e164: string | null | undefined) {
  if (!e164) return '—';
  // +923001234567 → +92 300 1234567
  const pk = /^\+92(\d{3})(\d{7})$/.exec(e164);
  return pk ? `+92 ${pk[1]} ${pk[2]}` : e164;
}
