import { runStreamNameOf } from '@on.auto/operations';
import type { Lineage, StreamAges } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { preparedVersion } from '../operations/definition-preparation.ts';
import { inputOf } from '../payloads/run-payloads.ts';
import type { RunCancel } from '../runs/run-commands.ts';
import {
  isChangedSinceRead,
  runDecider,
  runDeciderAsRead,
  placeOfRun,
  readerAt,
  writerAt,
} from '../runs/run-decider.ts';
import { attemptIsLive } from '../runs/run-decisions.ts';
import { endsWithinItsCall, startedRunOf, type RecordedRunState, type RunStreamState } from '../runs/run-state.ts';

type PersonsCancel = Pick<RunCancel, 'reason' | 'by' | 'at'>;

const longestOfTheRun = Effect.fnUntraced(function* (capabilities: readonly Capability[], run: RecordedRunState) {
  const capability = capabilities.find(({ type }) => type === run.run.type);
  if (capability === undefined) {
    return Option.none<number>();
  }
  const version = yield* Effect.option(preparedVersion(capability, run.run.name, run.run.definition_version));
  if (Option.isNone(version)) {
    return Option.none<number>();
  }
  const input = yield* inputOf(run);
  return 'read' in input ? Option.some(version.value.prepared.longestRunMsFor(input.read)) : Option.none<number>();
});

const diedWithinItsCall = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  ages: StreamAges,
  id: string,
  state: RunStreamState,
) {
  const run = startedRunOf(state);
  if (run === undefined || !endsWithinItsCall(run)) {
    return false;
  }
  const longest = yield* longestOfTheRun(capabilities, run);
  if (Option.isNone(longest)) {
    return false;
  }
  const quietMs = yield* ages.ageOfLastAppend(runStreamNameOf(id));
  return !attemptIsLive(quietMs, longest.value);
});

export const judgedCancelRecorded = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  id: string,
  asked: PersonsCancel,
  lineage: Lineage,
) {
  const place = yield* placeOfRun(id);
  const writer = yield* writerAt(place);
  const reader = yield* readerAt(place);
  const stream = runStreamNameOf(id);
  const cancel: RunCancel = { type: 'cancel', kind: 'requested', ...asked, runId: id };
  const recorded = Effect.asVoid(writer.execute(stream, runDecider, cancel, lineage));
  const read = (yield* reader.load(stream, runDeciderAsRead)).state;
  if (!(yield* diedWithinItsCall(capabilities, reader, id, read.state))) {
    return yield* recorded;
  }
  const afterItsAttempt: RunCancel = { ...cancel, attemptDied: true };
  return yield* Effect.asVoid(
    writer.execute(stream, runDeciderAsRead, { readAt: read.version, command: afterItsAttempt }, lineage),
  ).pipe(Effect.catchIf(isChangedSinceRead, () => recorded));
});
