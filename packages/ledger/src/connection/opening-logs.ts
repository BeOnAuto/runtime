import type { Context } from 'effect';

import { watchFailuresLoggedWith } from '../appended/append-watch.ts';
import type { PageFailed } from '../projection-catch-up/catch-up-page.ts';
import { pageFailuresLoggedWith } from '../projection-catch-up/caught-up.ts';
import { tablesMadeAgainLoggedWith, type TableMadeAgain } from '../projection-checkpoints/projection-checkpoints.ts';

interface OpeningLogs {
  readonly watchFailed: (failure: unknown) => void;
  readonly tableMadeAgain: TableMadeAgain;
  readonly pageFailed: PageFailed;
}

export function openingLogsWith(context: Context.Context<never>): OpeningLogs {
  return {
    watchFailed: watchFailuresLoggedWith(context),
    tableMadeAgain: tablesMadeAgainLoggedWith(context),
    pageFailed: pageFailuresLoggedWith(context),
  };
}
