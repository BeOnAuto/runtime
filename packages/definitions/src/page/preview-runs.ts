import { PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { loadRun } from '../operations/run-access.ts';
import { streamsOfRuns } from '../reading/list-runs.ts';
import { listedRunsOf } from '../reading/listed-run.ts';
import { runDetailOf } from '../runs/run-lookup.ts';
import { runShownOf } from './page-reads.ts';
import type { RunShown } from './page-rendering.ts';

export const latestRunOf = Effect.fnUntraced(function* (type: string, name: string) {
  const { records } = yield* (yield* PlaybookReader).readRecorded(streamsOfRuns(type, name), {
    order: 'desc',
    limit: 1,
  });
  const listed = yield* listedRunsOf(records);
  return yield* Effect.forEach(listed, ({ run_id: id }) =>
    Effect.map(Effect.orDie(Effect.flatMap(loadRun(id), (state) => runDetailOf(id, state))), runShownOf),
  ).pipe(Effect.map((shown: readonly RunShown[]) => shown[0]));
});

const runsLookedThrough = 20;

export const latestEndedRunOf = Effect.fnUntraced(function* (type: string, name: string) {
  const { records } = yield* (yield* PlaybookReader).readRecorded(streamsOfRuns(type, name), {
    order: 'desc',
    limit: runsLookedThrough,
  });
  const ended = (yield* listedRunsOf(records)).find(({ status }) => status !== 'started');
  return ended === undefined
    ? undefined
    : runShownOf(
        yield* Effect.orDie(Effect.flatMap(loadRun(ended.run_id), (state) => runDetailOf(ended.run_id, state))),
      );
});
