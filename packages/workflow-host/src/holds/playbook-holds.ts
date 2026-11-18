import type { RecordedEvent } from '@on.auto/operations';
import { mostTryAgainMs, PayloadOffloading, tryAgainAfter } from '@on.auto/operations/payloads';
import { Context, Effect, Random } from 'effect';

import {
  mostWaitOf,
  type FollowedOrgs,
  type HeldFor,
  type HeldPlaybook,
  type Hold,
  type ParkedPlaybook,
  type Progress,
} from '../follower/followed-orgs.ts';
import type { PassEnd } from '../follower/record-steps.ts';
import type { HostContext } from '../loop/forked-fibers.ts';

interface Lag {
  readonly records: number;
  readonly capped: boolean;
}

export interface HeldAtARecord {
  readonly heldFor: HeldFor;
  readonly record: Pick<RecordedEvent, 'id' | 'type'>;
  readonly lag: Lag;
}

export interface PassReached {
  readonly end: PassEnd;
  readonly records: number;
  readonly progress: Progress;
  readonly held?: HeldAtARecord;
}

export type TriedHold = Hold & { readonly heldFor: HeldFor };

export interface HoldTried {
  readonly hold: TriedHold;
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

export interface HeldTries extends Pick<FollowedOrgs, 'heldAt' | 'parkedForDelivery'> {
  readonly failed: (held: HeldPlaybook, failed: TryFailedAt) => Effect.Effect<void>;
}

export interface HoldNotes {
  readonly tried: (playbookKey: string, tried: HoldTried) => Effect.Effect<void>;
  readonly failed: (playbookKey: string, failed: HoldTryFailed) => Effect.Effect<void>;
  readonly lifted: (playbookKey: string, lifted: HoldLifted) => Effect.Effect<void>;
}

export const failedTryRetryMs = mostTryAgainMs;

export interface HoldParts {
  readonly orgs: Pick<FollowedOrgs, 'parked' | 'held' | 'lifted'>;
  readonly now: () => number;
  readonly holdNotes: HoldNotes;
}

export interface Parking {
  readonly playbookKey: string;
  readonly org: string;
  readonly hold: Hold | undefined;
}

export function holdsUnreadableIn({ context }: { readonly context?: HostContext }): boolean {
  return Context.get(context ?? Context.empty(), PayloadOffloading);
}

function triesBefore({ hold }: Parking, { heldFor }: HeldAtARecord, moved: boolean): number {
  return hold === undefined || hold.heldFor !== heldFor || moved ? 0 : hold.holds;
}

function waitOf(heldFor: HeldFor, holds: number, factor: number): number {
  return heldFor === 'delivery' ? 0 : Math.ceil(tryAgainAfter(holds, factor, mostWaitOf(heldFor)));
}

export function heldAgain(
  parts: HoldParts,
  parking: Parking,
  reached: Pick<PassReached, 'progress' | 'records'> & { readonly held: HeldAtARecord },
): Effect.Effect<void> {
  const { playbookKey, org, hold: before } = parking;
  const { held, progress } = reached;
  const at = parts.now();
  const holds = triesBefore(parking, held, reached.records > 0) + 1;
  return Effect.flatMap(Random.next, (factor) => {
    const hold = {
      heldFor: held.heldFor,
      since: before?.since ?? at,
      until: at + waitOf(held.heldFor, holds, factor),
      holds,
    };
    const tried: HoldTried = { hold, first: holds === 1, record: held.record, lag: held.lag, at };
    const parked: ParkedPlaybook = { playbookKey, org, progress, hold };
    return Effect.andThen(parts.orgs.parked(parked), parts.holdNotes.tried(playbookKey, tried));
  });
}

export function holdTryFailed(
  { orgs, holdNotes }: Pick<HoldParts, 'orgs' | 'holdNotes'>,
  { playbookKey, hold }: HeldPlaybook,
  { at, retryAt }: TryFailedAt,
): Effect.Effect<void> {
  return Effect.andThen(
    orgs.held(playbookKey, { ...hold, until: retryAt }),
    holdNotes.failed(playbookKey, { hold, at, retryAt }),
  );
}

function liftNoted(parts: HoldParts, { playbookKey, hold }: HeldPlaybook, reached: PassReached): Effect.Effect<void> {
  if (hold.holds === 0) {
    return Effect.void;
  }
  const lifted: HoldLifted = { hold, at: parts.now(), records: reached.records, more: reached.end === 'more' };
  return parts.holdNotes.lifted(playbookKey, lifted);
}

export function heldAfter(parts: HoldParts, held: HeldPlaybook, reached: PassReached): Effect.Effect<void> {
  if (reached.held !== undefined) {
    return heldAgain(parts, held, { ...reached, held: reached.held });
  }
  const noted = liftNoted(parts, held, reached);
  if (reached.end === 'caught_up') {
    return Effect.andThen(parts.orgs.lifted(held.playbookKey), noted);
  }
  const catchingUp: ParkedPlaybook = {
    ...held,
    progress: reached.progress,
    hold: { ...held.hold, until: parts.now(), holds: 0 },
  };
  return Effect.andThen(parts.orgs.parked(catchingUp), noted);
}
