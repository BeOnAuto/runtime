import { Effect, Option } from 'effect';
import { constant } from 'effect/Function';

import { textAsRead } from '../payloads/kept-texts.ts';
import { stagedVersion } from '../read-model-staging/staged-versions.ts';
import { pageResultOf, resultNamesTheOutput } from './page-presenting.ts';
import { subjectShownOf } from './page-reads.ts';
import type { RunShown } from './page-rendering.ts';
import type { Presented } from './presented-pages.ts';
import { runOfTheResult } from './result-runs.ts';
import type { ResultOver } from './subject-pages-port.ts';

type PlacedDefinitionResult = Parameters<typeof pageResultOf>[0];

function versionOfTheRun(run: RunShown): number | undefined {
  return 'version' in run ? run.version : undefined;
}

const placedForTheRun = Effect.fnUntraced(function* (
  type: string,
  { stored }: Presented,
  current: PlacedDefinitionResult,
  run: RunShown,
) {
  const version = versionOfTheRun(run);
  if (current.written === 'carried' || version === undefined || version === stored.version) {
    return current;
  }
  const ran = yield* Effect.orDie(stagedVersion(type, stored.name, version));
  const placed: PlacedDefinitionResult = { ...current, document: yield* textAsRead('source', ran.source) };
  return placed;
});

export const resultOfThePage = Effect.fnUntraced(function* (type: string, presented: Presented, over: ResultOver) {
  const { page, written, stored } = presented;
  const document = yield* textAsRead('source', page.document);
  const current = { document, written, of: 'definition' as const, subject: subjectShownOf(type, stored) };
  const readsOutput = resultNamesTheOutput(current);
  const run = yield* runOfTheResult(type, presented, over, readsOutput);
  if (run === undefined) {
    return run;
  }
  const placed = yield* placedForTheRun(type, presented, current, run);
  const rereads = !readsOutput && resultNamesTheOutput(placed);
  const read = rereads ? Option.fromNullishOr(yield* runOfTheResult(type, presented, over, true)) : Option.none();
  return yield* pageResultOf(placed, Option.getOrElse(read, constant(run)));
});
