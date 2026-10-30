import { Context } from 'effect';

import type { StreamWriter } from './stream-ports.ts';

export class PlaybookWriter extends Context.Service<PlaybookWriter, StreamWriter>()(
  '@on.auto/operations/PlaybookWriter',
) {}
