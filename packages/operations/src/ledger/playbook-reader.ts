import { Context } from 'effect';

import type { PlaybookContentReader } from '../content/recorded-content.ts';
import type { PlaybookProjectionReader } from '../projections/keyed-projection.ts';
import type {
  PlaybookAppendedFactsReader,
  PlaybookRecordedReader,
  PlaybookRunOutcomesReader,
  StreamAges,
  StreamReader,
} from './stream-ports.ts';

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
