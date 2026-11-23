import { sha256Of } from '@on.auto/content';
import type { PlaybookAddress } from '@on.auto/operations';
import { limitFloorMsOf, waitBefore } from '@on.auto/tool-servers';

import type { Destination } from '../events/destination-fields.ts';
import type { Polled } from '../subscriptions/subscription-records.ts';
import type { Round } from '../subscriptions/subscription-retries.ts';

export const checkedEveryMs = 60_000;

const millisOfASecond = 1000;

export function floorMsOf({ read_limit: limit }: Pick<Destination, 'read_limit'>): number {
  return limit === undefined || limit.clients !== undefined
    ? 0
    : limitFloorMsOf({ quota: limit.quota, windowSeconds: limit.window_seconds });
}

function checkWaitMs(destination: Pick<Destination, 'read_limit'>, retryAfterMs: number | null): number {
  return waitBefore({ baseMs: checkedEveryMs, floorMs: floorMsOf(destination), retryAfterMs });
}

export function pollingIntervalSecondsOf(destination: Pick<Destination, 'read_limit'>): number {
  return Math.ceil(checkWaitMs(destination, null) / millisOfASecond);
}

function slotOffsetOf({ org, playbook }: PlaybookAddress): number {
  return Number.parseInt(sha256Of(JSON.stringify([org, playbook])).slice(0, 12), 16) % checkedEveryMs;
}

export function checkDueAt(round: Pick<Round, 'now' | 'playbook'>, destination: Polled, retryAfterMs: number | null) {
  const waitMs = checkWaitMs(destination, retryAfterMs);
  const offsetMs = slotOffsetOf(round.playbook);
  const slots = (round.now + waitMs - offsetMs) / checkedEveryMs;
  return offsetMs + (waitMs > checkedEveryMs ? Math.ceil(slots) : Math.round(slots)) * checkedEveryMs;
}
