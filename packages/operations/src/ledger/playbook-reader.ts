import type { StreamedContent } from '@on.auto/content';
import { Context, type Effect } from 'effect';

import type { PlaybookProjectionReader } from '../projections/keyed-projection.ts';
import type {
  PlaybookAppendedFactsReader,
  PlaybookRecordedReader,
  PlaybookRunOutcomesReader,
  StreamAges,
  StreamReader,
} from './stream-ports.ts';

export interface PlaybookContentReader {
  readonly readContent: (sha256: string) => Effect.Effect<StreamedContent | undefined>;
}

export class PlaybookReader extends Context.Service<
  PlaybookReader,
  StreamReader &
    StreamAges &
    PlaybookRecordedReader &
    PlaybookAppendedFactsReader &
    PlaybookRunOutcomesReader &
    PlaybookProjectionReader &
    PlaybookContentReader
>()('@on.auto/operations/PlaybookReader') {}
