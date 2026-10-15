import type { Role, SessionUser } from '../../../src/domain/api-types.ts';
import type { Round } from '../../../src/domain/types.ts';

/** Raters write only their own card, only while the round is open. Admins write any card. */
export function cardWriteProblem(actor: SessionUser, round: Round, ownerId: number): string | undefined {
  if (actor.role === 'admin') return undefined;
  if (actor.id !== ownerId) return 'You can only change your own scorecard.';
  if (round.status !== 'open') {
    return `${round.label} is published, so scores can no longer be changed. Ask an admin if a score needs correcting.`;
  }
  return undefined;
}

interface UserState {
  id: number;
  role: Role;
  active: boolean;
}

export function userChangeProblem(
  actor: SessionUser,
  target: UserState,
  change: { role?: Role; active?: boolean },
  activeAdmins: number,
): string | undefined {
  const losesAdmin =
    target.role === 'admin' &&
    target.active &&
    ((change.role !== undefined && change.role !== 'admin') || change.active === false);
  if (!losesAdmin) return undefined;
  if (target.id === actor.id) return 'You cannot remove your own admin access. Ask another admin to make this change.';
  if (activeAdmins <= 1) return 'Keep at least one active admin. Make another user an admin first.';
  return undefined;
}
