import type { PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ChainReads } from './chain-origins.ts';

export function playbookChainReads(reader: PlaybookReader['Service']): ChainReads<never> {
  return {
    firstFactOf: (run) =>
      reader.readRecorded({ kind: 'run', run }, { order: 'asc', limit: 1, dataOf: [] }).pipe(
        Effect.map(({ records: [first] }) => first),
        Effect.orDie,
      ),
    recordOf: (id) => reader.readRecordedEvent(id),
  };
}
