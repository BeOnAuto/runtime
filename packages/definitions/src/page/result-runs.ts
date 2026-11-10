import type { InvalidInput, PlaybookContext, PlaybookReader } from '@on.auto/operations';
import type { Effect } from 'effect';

import type { RunShown } from './page-rendering.ts';
import type { Presented } from './presented-pages.ts';
import { givenRunShown, latestRunOf } from './preview-runs.ts';
import { sampleRunOf } from './sample-runs.ts';
import type { ResultOver } from './subject-pages-port.ts';

type ReadInPlace<A, E = never> = Effect.Effect<A, E, PlaybookReader | PlaybookContext>;

export function runOfTheResult(
  type: string,
  { stored }: Presented,
  over: ResultOver,
  readsOutput: boolean,
): ReadInPlace<RunShown | undefined, InvalidInput> {
  if ('run' in over) {
    return givenRunShown(over, readsOutput);
  }
  return 'sample' in over ? sampleRunOf(stored, over.sample) : latestRunOf(type, stored.name, readsOutput);
}
