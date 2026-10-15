import { describe, expect, it } from 'vitest';
import { formatTimestamp } from './format';

describe('formatTimestamp', () => {
  it('shows the month, day, and time, without a year, in any time zone', () => {
    expect(formatTimestamp('2026-10-15T20:42:00Z')).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s[AP]M$/);
  });
});
