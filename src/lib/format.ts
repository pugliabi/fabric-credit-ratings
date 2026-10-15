const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
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

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
