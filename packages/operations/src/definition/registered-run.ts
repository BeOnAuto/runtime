import type { Effect } from 'effect';

import type { Rejected, Succeeded } from '../outcome/outcome.ts';

export type InputEncoding = 'json' | 'strings';

export type RegisteredRun<Services, S extends Succeeded = Succeeded> = (
  input: unknown,
  encoding: InputEncoding,
) => Effect.Effect<S, Rejected, Services>;
