import type { RecordedEvent } from '@on.auto/operations';
import { mostTryAgainMs, PayloadsOutside, tryAgainAfter } from '@on.auto/operations/payloads';
import { Context, Effect, Random } from 'effect';

import type {
  FollowedPlaybook,
  FollowedPlaybooks,
  HeldFor,
  HeldPlaybook,
  Hold,
} from '../follower/followed-playbooks.ts';
import type { Held, PassEnd } from '../follower/record-steps.ts';
import type { HostContext } from '../loop/forked-fibers.ts';

interface Lag {
  readonly records: number;
  readonly capped: boolean;
}

export interface HeldAtARecord extends Held {
  readonly lag: Lag;
}

export interface PassReached {
  readonly end: PassEnd;
  readonly records: number;
  readonly held?: HeldAtARecord;
}

export interface HoldTried {
  readonly hold: Hold;
  readonly first: boolean;
  readonly record: Pick<RecordedEvent, 'id' | 'type'>;
  readonly lag: Lag;
  readonly at: number;
}

export interface HoldLifted {
  readonly hold: Hold;
  readonly at: number;
  readonly records: number;
  readonly more: boolean;
}

interface TryFailedAt {
  readonly at: number;
  readonly retryAt: number;
}

interface HoldTryFailed extends TryFailedAt {
  readonly hold: Hold;
}

export interface HeldTries extends Pick<FollowedPlaybooks, 'heldAt'> {
  readonly failed: (held: HeldPlaybook, failed: TryFailedAt) => Effect.Effect<void>;
}

export interface HoldNotes {
  readonly tried: (playbookKey: string, tried: HoldTried) => Effect.Effect<void>;
  readonly failed: (playbookKey: string, failed: HoldTryFailed) => Effect.Effect<void>;
  readonly lifted: (playbookKey: string, lifted: HoldLifted) => Effect.Effect<void>;
}

const mostUnreadableWaitMs = 5 * 60_000;

export const failedTryRetryMs = mostTryAgainMs;

const mostWaitMs: Readonly<Record<HeldFor, number>> = { content: mostTryAgainMs, unreadable: mostUnreadableWaitMs };

export interface HoldParts {
  readonly playbooks: Pick<FollowedPlaybooks, 'held' | 'lifted'>;
  readonly now: () => number;
  readonly holdNotes: HoldNotes;
}

export function holdsUnreadableIn({ context }: { readonly context?: HostContext }): boolean {
  return Context.get(context ?? Context.empty(), PayloadsOutside);
}

export function isHeldAt({ hold }: Pick<FollowedPlaybook, 'hold'>, now: number): boolean {
  return hold !== undefined && now < hold.until;
}

function triesBefore({ hold }: FollowedPlaybook, { heldFor }: HeldAtARecord, moved: boolean): number {
  return hold === undefined || hold.heldFor !== heldFor || moved ? 0 : hold.holds;
}

function heldAgain(
  parts: HoldParts,
  followed: FollowedPlaybook,
  held: HeldAtARecord,
  moved: boolean,
): Effect.Effect<void> {
  const { playbookKey, hold: before } = followed;
  const at = parts.now();
  const holds = triesBefore(followed, held, moved) + 1;
  return Effect.flatMap(Random.next, (factor) => {
    const hold: Hold = {
      heldFor: held.heldFor,
      since: before?.since ?? at,
      until: at + Math.ceil(tryAgainAfter(holds, factor, mostWaitMs[held.heldFor])),
      holds,
    };
    const tried: HoldTried = { hold, first: holds === 1, record: held.record, lag: held.lag, at };
    return Effect.andThen(parts.playbooks.held(playbookKey, hold), parts.holdNotes.tried(playbookKey, tried));
  });
}

export function holdTryFailed(
  { playbooks, holdNotes }: Pick<HoldParts, 'playbooks' | 'holdNotes'>,
  { playbookKey, hold }: HeldPlaybook,
  { at, retryAt }: TryFailedAt,
): Effect.Effect<void> {
  return Effect.andThen(
    playbooks.held(playbookKey, { ...hold, until: retryAt }),
    holdNotes.failed(playbookKey, { hold, at, retryAt }),
  );
}

export function holdAfter(parts: HoldParts, followed: FollowedPlaybook, reached: PassReached): Effect.Effect<void> {
  const { playbookKey, hold } = followed;
  if (reached.held !== undefined) {
    return heldAgain(parts, followed, reached.held, reached.records > 0);
  }
  if (hold === undefined) {
    return Effect.void;
  }
  const lifted: HoldLifted = { hold, at: parts.now(), records: reached.records, more: reached.end === 'more' };
  return Effect.andThen(parts.playbooks.lifted(playbookKey), parts.holdNotes.lifted(playbookKey, lifted));
}
