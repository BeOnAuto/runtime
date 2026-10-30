import type { Effect } from 'effect';

import type { StreamedContent } from '../content/streamed-content.ts';
import type { Answered, Rejected, Succeeded } from '../outcome/outcome.ts';

export type InputEncoding = 'json' | 'strings';

export type RegisteredRun<Services, S extends Succeeded = Answered> = (
  input: unknown,
  encoding: InputEncoding,
  body?: StreamedContent,
) => Effect.Effect<S, Rejected, Services>;
