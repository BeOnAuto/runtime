import type { Lineage } from '@on.auto/operations';
import { Effect } from 'effect';

import { comparedWithoutItsValue } from '../payloads/payload-comparisons.ts';
import { comparedWithItsRecordedInput } from '../runs/run-claims.ts';
import type { RunStart } from '../runs/run-commands.ts';
import { fencingTokenOf } from '../runs/run-state.ts';
import { loadRunStream, recordStart } from './run-access.ts';

const comparedAfterReading = Effect.fnUntraced(function* (
  id: string,
  start: RunStart,
  definition: string,
  lineage: Lineage,
) {
  const compared = yield* comparedWithItsRecordedInput(yield* loadRunStream(id), start);
  return yield* recordStart(id, { ...start, ...compared }, definition, lineage);
});

function recordedStart(id: string, start: RunStart, definition: string, lineage: Lineage) {
  return recordStart(id, start, definition, lineage).pipe(
    Effect.catchIf(
      (refused: unknown) => refused === comparedWithoutItsValue,
      () => comparedAfterReading(id, start, definition, lineage),
    ),
  );
}

export const startRecorded = Effect.fnUntraced(function* (
  id: string,
  start: RunStart,
  definition: string,
  lineage: Lineage,
) {
  const recorded = yield* recordedStart(id, start, definition, lineage);
  return { ...recorded, fencingToken: fencingTokenOf(recorded.state) };
});
