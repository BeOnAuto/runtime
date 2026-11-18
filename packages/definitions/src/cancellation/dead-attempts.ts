import {
  streamPrefixOfPlaybook,
  type LedgerPorts,
  type Lineage,
  type ProjectionReader,
  type StreamAges,
  type StreamReader,
  type StreamWriter,
  runStreamNameOf,
} from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { KeptContentReader } from '../payloads/run-payloads.ts';
import type { RunCancel } from '../runs/run-commands.ts';
import { isChangedSinceRead, runDecider, runDeciderAsRead, runStreamIn, type RunPlacing } from '../runs/run-decider.ts';
import { attemptIsLive } from '../runs/run-decisions.ts';
import type { CalledRun } from '../runs/run-settler.ts';
import { endsWithinItsCall, startedRunOf, type RunStreamState } from '../runs/run-state.ts';
import { longestRunOf } from './longest-runs.ts';

export type CancelLedger = StreamReader &
  StreamAges &
  StreamWriter &
  ProjectionReader &
  KeptContentReader &
  RunPlacing &
  Pick<LedgerPorts, 'holderOfName'>;

interface CancellingParts {
  readonly ledger: CancelLedger;
  readonly capabilities: readonly Capability[];
  readonly mayBeLive: (quietForMs: number) => Effect.Effect<void>;
}

interface Judged {
  readonly died: boolean;
  readonly longestRunMs: number;
}

export interface Cancelling extends CancellingParts {
  readonly run: CalledRun;
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

export const streamToCancel = Effect.fnUntraced(function* (ledger: CancelLedger, run: CalledRun, runId: string) {
  const placed = yield* runStreamIn(ledger, { ...run, id: runId });
  if (placed !== undefined) {
    return placed;
  }
  const { definitionType, name } = run;
  const held = yield* ledger.holderOfName({ playbookKey: streamPrefixOfPlaybook(run), definitionType, name });
  return held === undefined ? undefined : `${held.definitionKey}${runStreamNameOf(runId)}`;
});

export const cancelRecorded = Effect.fnUntraced(function* (
  cancelling: Cancelling,
  asked: CallerCancel,
  lineage: Lineage,
) {
  const cancel: RunCancel = { type: 'cancel', ...asked, byItsCaller: true };
  const { ledger, stream } = cancelling;
  const recorded = Effect.asVoid(ledger.execute(stream, runDecider, cancel, lineage));
  const read = (yield* ledger.load(stream, runDeciderAsRead)).state;
  const judged = yield* judgedWithinItsCall(cancelling, read.state);
  if (Option.isNone(judged)) {
    return yield* recorded;
  }
  const { died, longestRunMs } = judged.value;
  const lookedAtAgain = Effect.andThen(recorded, cancelling.mayBeLive(longestRunMs));
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
