import {
  PlaybookContext,
  PlaybookIdSchema,
  OrgIdSchema,
  playbookCallerOf,
  type Conflict,
  type Lineage,
} from '@on.auto/operations';
import { DateTime, Effect, Equal, Option, Schema } from 'effect';

import { attemptKeyOf, LiveAttempts } from '../attempts/live-attempts.ts';
import type { Capability } from '../capability/capability.ts';
import { loadRunStream } from '../operations/run-access.ts';
import { endedBeforeCancelling } from '../runs/run-decisions.ts';
import type { CancelRequestKind } from '../runs/run-events.ts';
import { runOf } from '../runs/run-lookup.ts';
import type { RunStreamAddress } from '../runs/run-settler.ts';
import { cancelRecorded, type CancelLedger } from './dead-attempts.ts';

export interface CancelRequest {
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly by?: string;
}

export type CancelReceipt = 'requested' | 'ended' | 'unknown_run';

export type CancelRun = (
  run: RunStreamAddress,
  request: CancelRequest,
  lineage: Lineage,
) => Effect.Effect<CancelReceipt, Conflict>;

export interface CancelOfALiveAttempt {
  readonly run: RunStreamAddress;
  readonly request: CancelRequest;
  readonly lineage: Lineage;
  readonly quietForMs: number;
}

export type LookAgain = (cancel: CancelOfALiveAttempt) => Effect.Effect<void>;

const neverLookedAtAgain: LookAgain = () => Effect.void;

const isWellFormed = Schema.is(
  Schema.Struct({ org: OrgIdSchema, playbook: PlaybookIdSchema, id: Schema.String.check(Schema.isUUID()) }),
);

function endedFirst(error: unknown): boolean {
  return Equal.equals(error, endedBeforeCancelling);
}

const attemptHereStopped = Effect.fnUntraced(function* (key: string) {
  const live = yield* Effect.serviceOption(LiveAttempts);
  return yield* Option.match(live, { onNone: () => Effect.void, onSome: (attempts) => attempts.interrupt(key) });
});

export const runAfterItsAttemptHere = Effect.fnUntraced(function* (id: string) {
  yield* attemptHereStopped(attemptKeyOf(yield* PlaybookContext, id));
  return yield* runOf(id, yield* loadRunStream(id));
});

export function runCanceller(
  ledger: CancelLedger,
  capabilities: readonly Capability[] = [],
  lookAgain: LookAgain = neverLookedAtAgain,
): CancelRun {
  return (run, request, lineage) =>
    Effect.gen(function* () {
      if (!isWellFormed(run)) {
        return 'unknown_run';
      }
      const runId = run.id.toLowerCase();
      const at = DateTime.formatIso(yield* DateTime.now);
      const { kind, reason, by = playbookCallerOf(run).id } = request;
      const mayBeLive = (quietForMs: number) => lookAgain({ run, request, lineage, quietForMs });
      return yield* cancelRecorded(
        { ledger, capabilities, mayBeLive },
        run,
        { kind, reason, runId, by, at },
        lineage,
      ).pipe(
        Effect.andThen(attemptHereStopped(attemptKeyOf(run, runId))),
        Effect.as<CancelReceipt>('requested'),
        Effect.catchTags({ not_found: Effect.die, cancelled: Effect.die, unavailable: Effect.die }),
        Effect.catchIf(endedFirst, () => Effect.succeed<CancelReceipt>('ended')),
      );
    });
}
