import { PlaybookReader, type PlaybookContext } from '@on.auto/operations';
import { Effect } from 'effect';

import { loadRun } from '../operations/run-access.ts';
import { streamsOfRuns } from '../reading/list-runs.ts';
import { listedRunsOf } from '../reading/listed-run.ts';
import { runDetailOf } from '../runs/run-lookup.ts';
import { outputOf } from '../runs/run-payloads.ts';
import { runShownOf } from './page-reads.ts';
import type { RunShown } from './page-rendering.ts';
import type { ResultOver } from './subject-pages-port.ts';

const shownRunOf = Effect.fnUntraced(function* (id: string, readsOutput: boolean) {
  const detail = yield* Effect.orDie(Effect.flatMap(loadRun(id), (state) => runDetailOf(id, state)));
  return runShownOf(detail, readsOutput ? yield* outputOf(detail) : undefined);
});

export const latestRunOf = Effect.fnUntraced(function* (type: string, name: string, readsOutput: boolean) {
  const { records } = yield* (yield* PlaybookReader).readRecorded(streamsOfRuns(type, name), {
    order: 'desc',
    limit: 1,
  });
  const [latest] = yield* listedRunsOf(records);
  return latest === undefined ? undefined : yield* shownRunOf(latest.run_id, readsOutput);
});

const runsLookedThrough = 20;

export const latestEndedRunOf = Effect.fnUntraced(function* (type: string, name: string, readsOutput: boolean) {
  const { records } = yield* (yield* PlaybookReader).readRecorded(streamsOfRuns(type, name), {
    order: 'desc',
    limit: runsLookedThrough,
  });
  const ended = (yield* listedRunsOf(records)).find(({ status }) => status !== 'started');
  return ended === undefined ? undefined : yield* shownRunOf(ended.run_id, readsOutput);
});

export function givenRunShown(
  over: Extract<ResultOver, { readonly run: unknown }>,
  readsOutput: boolean,
): Effect.Effect<RunShown, never, PlaybookReader | PlaybookContext> {
  const { run, read } = over;
  return read !== undefined || !readsOutput
    ? Effect.succeed(runShownOf(run, read))
    : Effect.map(outputOf(run), (found) => runShownOf(run, found));
}
