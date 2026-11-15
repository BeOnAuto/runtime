import type { Lineage } from '@on.auto/operations';
import { Effect } from 'effect';

import { acquiredHere } from '../attempts/live-attempts.ts';
import { comparedWithoutItsValue } from '../payloads/payload-comparisons.ts';
import { comparedWithItsRecordedInput } from '../runs/run-claims.ts';
import type { RunStart } from '../runs/run-commands.ts';
import { fencingTokenOf } from '../runs/run-state.ts';
import { loadRunStream, recordRun } from './run-access.ts';

const comparedAfterReading = Effect.fnUntraced(function* (id: string, start: RunStart, lineage: Lineage) {
  const compared = yield* comparedWithItsRecordedInput(yield* loadRunStream(id), start);
  return yield* recordRun(id, { ...start, ...compared }, lineage);
});

function recordedStart(id: string, start: RunStart, lineage: Lineage) {
  return recordRun(id, start, lineage).pipe(
    Effect.catchIf(
      (refused: unknown) => refused === comparedWithoutItsValue,
      () => comparedAfterReading(id, start, lineage),
    ),
  );
}

export const startRecorded = Effect.fnUntraced(function* (id: string, start: RunStart, lineage: Lineage) {
  const recorded = yield* recordedStart(id, start, lineage);
  const fencingToken = fencingTokenOf(recorded.state);
  yield* acquiredHere(id, fencingToken);
  return { ...recorded, fencingToken };
});
