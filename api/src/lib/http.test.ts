import { describe, expect, it } from 'vitest';
import { clientIp, corsHeaders } from './http.ts';

describe('corsHeaders', () => {
  it('echoes allowed origins with credentials', () => {
    expect(corsHeaders('https://fabriccreditratings.com', ['https://fabriccreditratings.com'])).toMatchObject({
      'Access-Control-Allow-Origin': 'https://fabriccreditratings.com',
      'Access-Control-Allow-Credentials': 'true',
    });
  });

  it('sends no allow-origin for other sites', () => {
    expect(corsHeaders('https://evil.example', ['https://fabriccreditratings.com'])).not.toHaveProperty(
      'Access-Control-Allow-Origin',
    );
  });
});

describe('clientIp', () => {
  it('takes the last forwarded address without its port', () => {
    expect(clientIp('198.51.100.9, 203.0.113.7:51234')).toBe('203.0.113.7');
    expect(clientIp('203.0.113.7')).toBe('203.0.113.7');
    expect(clientIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(clientIp('2001:db8::1')).toBe('2001:db8::1');
    expect(clientIp('198.51.100.9, [2001:db8::1]:443')).toBe('2001:db8::1');
  });

  it('returns unknown for anything that is not an IP address', () => {
    expect(clientIp(null)).toBe('unknown');
    expect(clientIp('')).toBe('unknown');
    expect(clientIp('203.0.113.7, ')).toBe('unknown');
    expect(clientIp('not-an-ip')).toBe('unknown');
    expect(clientIp('a'.repeat(150))).toBe('unknown');
    expect(clientIp('203.0.113.7, not-an-ip')).toBe('unknown');
  });
});
