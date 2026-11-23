import type { PlaybookAddress } from '@on.auto/operations';
import { waitBefore } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { waitAfter } from '../sockets/socket-listening.ts';
import type { Through } from './held-subscriptions.ts';
import type { SubscriptionCallFailed, SubscriptionFailureKind } from './subscription-failed.ts';
import type {
  LoopConnection,
  Positions,
  RecordedSubscription,
  SubscriptionCalls,
  SubscriptionKey,
  SubscriptionLoopPorts,
  SubscriptionPlace,
} from './subscription-ports.ts';
import { holdsARead, isLasting, isTheSameFailure, retryWaitOf, withLapse } from './subscription-records.ts';

export interface Round {
  readonly ports: SubscriptionLoopPorts;
  readonly calls: SubscriptionCalls;
  readonly playbook: PlaybookAddress;
  readonly now: number;
  readonly connections: ReadonlyMap<string, LoopConnection>;
  readonly unreadFor: ReadonlyMap<string, Pick<SubscriptionCallFailed, 'kind' | 'because'>>;
}

export type Later = readonly number[];

export const nothingLater: Later = [];

export function laterAt(time: number | undefined): Later {
  return time === undefined ? nothingLater : [time];
}

export function placeOf({ playbook }: Round, { connection }: SubscriptionKey): SubscriptionPlace {
  return { ...playbook, connection };
}

export interface Acting extends Through {
  readonly key: SubscriptionKey;
  readonly recorded?: RecordedSubscription | undefined;
}

export type CallFailure = Pick<SubscriptionCallFailed, 'kind' | 'because'> & {
  readonly retryAfterMs?: number | null;
};

export interface Attempt {
  readonly recordsWhatPasses: boolean;
  readonly makes: boolean;
  readonly holds: (kind: SubscriptionFailureKind) => boolean;
}

export const aSubscribe: Attempt = { recordsWhatPasses: true, makes: true, holds: isLasting };

export const aSubscribeNotSent: Attempt = { recordsWhatPasses: true, makes: false, holds: isLasting };

export const aSubscribeAgain: Attempt = { recordsWhatPasses: false, makes: true, holds: isLasting };

export const aCallOnWhatIsMade: Attempt = { recordsWhatPasses: false, makes: false, holds: isLasting };

export const aRead: Attempt = { recordsWhatPasses: false, makes: false, holds: holdsARead };

export interface Positioned {
  readonly positions: Positions;
  readonly later: Later;
}

export function failureOutcome(
  round: Round,
  acting: Acting,
  failure: CallFailure,
  { recordsWhatPasses, makes, holds }: Attempt,
): Effect.Effect<Positioned> {
  const { kind, because, retryAfterMs = null } = failure;
  const { key, recorded, generation } = acting;
  const failed = { kind, because, attempted: generation };
  const failures = recorded?.positions?.failures ?? 0;
  const lapsesAt = recorded?.positions?.lapsesAt;
  return Effect.gen(function* () {
    if ((isLasting(kind) || recordsWhatPasses) && !isTheSameFailure(recorded?.failed, failed)) {
      yield* round.ports.records.failed(round.playbook, key, failed);
    }
    if (holds(kind)) {
      return { positions: withLapse({ failures: 0, dueAt: round.now }, lapsesAt), later: laterAt(lapsesAt) };
    }
    const retryMs = retryWaitOf(acting.destination, { because, makes }, yield* waitAfter(failures));
    const dueAt = round.now + waitBefore({ baseMs: retryMs, floorMs: 0, retryAfterMs });
    return { positions: withLapse({ failures: failures + 1, dueAt }, lapsesAt), later: laterAt(dueAt) };
  });
}

export function moved(round: Round, key: SubscriptionKey, positions: Positions): Effect.Effect<Later> {
  return Effect.as(round.ports.records.moved(round.playbook, key, positions), laterAt(positions.dueAt));
}

export function failedOn(round: Round, acting: Acting, failure: CallFailure, attempt: Attempt): Effect.Effect<Later> {
  return Effect.flatMap(failureOutcome(round, acting, failure, attempt), ({ positions, later }) =>
    Effect.as(round.ports.records.moved(round.playbook, acting.key, positions), later),
  );
}
