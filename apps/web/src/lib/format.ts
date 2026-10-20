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

/** Money is stored in minor units (paisa for PKR); whole amounts are shown without decimals. */
export function formatMoney(minor: number, currencyCode: string) {
  const major = minor / 100;
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: currencyCode,
    currencyDisplay: 'code',
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}

/** Today's calendar date in the gym's timezone, as YYYY-MM-DD (used for date input limits). */
export function gymTodayIso(timeZone = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

/** Wall-clock parts of an instant in `timeZone`. */
function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** An instant as a `datetime-local` value (YYYY-MM-DDTHH:mm) in gym time. */
export function toGymDateTimeInput(iso: string, timeZone = DEFAULT_TZ) {
  const { date, time } = zonedParts(new Date(iso), timeZone);
  return `${date}T${time}`;
}

/** A `datetime-local` value entered in gym time, as an ISO timestamp (UTC). */
export function gymDateTimeInputToIso(value: string, timeZone = DEFAULT_TZ) {
  const [date = '', time = ''] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  // The zone's offset at that moment: how far its wall clock is from UTC.
  const shown = zonedParts(new Date(wall), timeZone);
  const [shownHour, shownMinute] = shown.time.split(':').map(Number);
  const [shownYear, shownMonth, shownDay] = shown.date.split('-').map(Number);
  const offset = Date.UTC(shownYear!, shownMonth! - 1, shownDay!, shownHour!, shownMinute!) - wall;
  return new Date(wall - offset).toISOString();
}

export function formatTime(iso: string | null | undefined, timeZone = DEFAULT_TZ) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** "1 h 25 min" between two instants. */
export function formatDuration(fromIso: string, toIso: string) {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}
