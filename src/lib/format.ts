const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const timestamp = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const monthOnly = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

export function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function formatMonthYear(iso: string): string {
  return monthYear.format(parseDate(iso));
}

export function formatFullDate(iso: string): string {
  return fullDate.format(parseDate(iso));
}

export function formatMonth(date: Date): string {
  return monthOnly.format(date);
}

/** 6 -> "6", 6.5 -> "6.5". Averaged scores carry at most one decimal. */
export function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Like formatScore, but a factor that does not apply (null) reads "n/a". */
export function formatScoreOrNa(value: number | null): string {
  return value === null ? 'n/a' : formatScore(value);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "Oct 15, 3:42 PM" in the reader's time zone. */
export function formatTimestamp(iso: string): string {
  return timestamp.format(new Date(iso));
}
