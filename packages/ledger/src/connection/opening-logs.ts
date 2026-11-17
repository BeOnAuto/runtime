import type { Context } from 'effect';

import { watchFailuresLoggedWith } from '../appended/append-watch.ts';
import { tablesMadeAgainLoggedWith, type TableMadeAgain } from '../projection-checkpoints/projection-checkpoints.ts';

interface OpeningLogs {
  readonly watchFailed: (failure: unknown) => void;
  readonly tableMadeAgain: TableMadeAgain;
}

export function openingLogsWith(context: Context.Context<never>): OpeningLogs {
  return { watchFailed: watchFailuresLoggedWith(context), tableMadeAgain: tablesMadeAgainLoggedWith(context) };
}
