import { PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { RunShown } from '../capability/definition-kinds.ts';
import { loadRun } from '../operations/run-access.ts';
import { streamsOfRuns } from '../reading/list-runs.ts';
import { listedRunsOf } from '../reading/listed-run.ts';
import { runDetailOf } from '../runs/run-lookup.ts';
import { runShownOf } from './page-reads.ts';

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
