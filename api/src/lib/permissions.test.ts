import { describe, expect, it } from 'vitest';
import type { SessionUser } from '../../../src/domain/api-types.ts';
import type { Round } from '../../../src/domain/types.ts';
import { cardWriteProblem, userChangeProblem } from './permissions.ts';

const admin: SessionUser = { id: 1, login: 'boss', displayName: 'Boss', role: 'admin' };
const rater: SessionUser = { id: 2, login: 'ann', displayName: 'Ann', role: 'rater' };
const open: Round = { id: '2026-Q4', label: 'Q4 2026', status: 'open', publishedOn: null };
const published: Round = { ...open, status: 'published', publishedOn: '2026-10-15' };

describe('cardWriteProblem', () => {
  it('lets raters write their own card in the open round', () => {
    expect(cardWriteProblem(rater, open, 2)).toBeUndefined();
  });

  it('keeps raters off other cards', () => {
    expect(cardWriteProblem(rater, open, 3)).toBe('You can only change your own scorecard.');
  });

  it('keeps raters out of published rounds', () => {
    expect(cardWriteProblem(rater, published, 2)).toBe(
      'Q4 2026 is published, so scores can no longer be changed. Ask an admin if a score needs correcting.',
    );
  });

  it('lets admins write any card in any round', () => {
    expect(cardWriteProblem(admin, published, 2)).toBeUndefined();
  });
});

describe('userChangeProblem', () => {
  const self = { id: 1, role: 'admin' as const, active: true };
  const otherAdmin = { id: 5, role: 'admin' as const, active: true };

  it('stops admins from demoting or disabling themselves', () => {
    const message = 'You cannot remove your own admin access. Ask another admin to make this change.';
    expect(userChangeProblem(admin, self, { role: 'rater' }, 2)).toBe(message);
    expect(userChangeProblem(admin, self, { active: false }, 2)).toBe(message);
  });

  it('keeps at least one active admin', () => {
    expect(userChangeProblem(admin, otherAdmin, { active: false }, 1)).toBe(
      'Keep at least one active admin. Make another user an admin first.',
    );
  });

  it('allows ordinary changes', () => {
    expect(userChangeProblem(admin, otherAdmin, { role: 'rater' }, 2)).toBeUndefined();
    expect(userChangeProblem(admin, { id: 2, role: 'rater', active: true }, { active: false }, 1)).toBeUndefined();
  });
});
