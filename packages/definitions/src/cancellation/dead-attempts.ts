import {
  streamPrefixOfPlaybook,
  type Lineage,
  type ProjectionReader,
  type StreamAges,
  type StreamReader,
  type StreamWriter,
} from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { KeptContentReader } from '../payloads/run-payloads.ts';
import type { RunCancel } from '../runs/run-commands.ts';
import { isChangedSinceRead, runDecider, runDeciderAsRead, runStreamNameOf } from '../runs/run-decider.ts';
import { attemptIsLive } from '../runs/run-decisions.ts';
import type { RunStreamAddress } from '../runs/run-settler.ts';
import { endsWithinItsCall, startedRunOf, type RunStreamState } from '../runs/run-state.ts';
import { longestRunOf } from './longest-runs.ts';

export type CancelLedger = StreamReader & StreamAges & StreamWriter & ProjectionReader & KeptContentReader;

interface CancellingParts {
  readonly ledger: CancelLedger;
  readonly capabilities: readonly Capability[];
  readonly mayBeLive: (quietForMs: number) => Effect.Effect<void>;
}

interface Judged {
  readonly died: boolean;
  readonly longestRunMs: number;
}

interface Cancelling extends CancellingParts {
  readonly run: RunStreamAddress;
  readonly stream: string;
}

function judgedWithinItsCall(cancelling: Cancelling, state: RunStreamState): Effect.Effect<Option.Option<Judged>> {
  const run = startedRunOf(state);
  if (run === undefined || !endsWithinItsCall(run)) {
    return Effect.succeedNone;
  }
  return Effect.flatMap(
    longestRunOf(cancelling, run),
    Option.match({
      onNone: () => Effect.succeedNone,
      onSome: (longestRunMs) =>
        Effect.map(cancelling.ledger.ageOfLastAppend(cancelling.stream), (quietMs) =>
          Option.some({ died: !attemptIsLive(quietMs, longestRunMs), longestRunMs }),
        ),
    }),
  );
}

type CallerCancel = Pick<RunCancel, 'kind' | 'reason' | 'runId' | 'by' | 'at'>;

export const cancelRecorded = Effect.fnUntraced(function* (
  parts: CancellingParts,
  run: RunStreamAddress,
  asked: CallerCancel,
  lineage: Lineage,
) {
  const cancel: RunCancel = { type: 'cancel', ...asked, byItsCaller: true };
  const stream = `${streamPrefixOfPlaybook(run)}${runStreamNameOf(cancel.runId)}`;
  const { ledger } = parts;
  const recorded = Effect.asVoid(ledger.execute(stream, runDecider, cancel, lineage));
  const read = (yield* ledger.load(stream, runDeciderAsRead)).state;
  const judged = yield* judgedWithinItsCall({ ...parts, run, stream }, read.state);
  if (Option.isNone(judged)) {
    return yield* recorded;
  }
  const { died, longestRunMs } = judged.value;
  const lookedAtAgain = Effect.andThen(recorded, parts.mayBeLive(longestRunMs));
  if (!died) {
    return yield* lookedAtAgain;
  }
  const afterItsAttempt: RunCancel = { ...cancel, attemptDied: true };
  return yield* ledger
    .execute(stream, runDeciderAsRead, { readAt: read.version, command: afterItsAttempt }, lineage)
    .pipe(
      Effect.asVoid,
      Effect.catchIf(isChangedSinceRead, () => lookedAtAgain),
    );
});
