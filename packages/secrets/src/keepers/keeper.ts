import type { Effect, Redacted } from 'effect';

import type { Holding } from '../rows/secret-rows.ts';
import type { SecretKeyUnknown } from './secret-key-unknown.ts';

export interface Keeper {
  readonly name: string;
  readonly hold: (id: string, value: Redacted.Redacted) => Effect.Effect<Holding>;
  readonly reveal: (holding: Holding) => Effect.Effect<Redacted.Redacted, SecretKeyUnknown>;
  readonly release: (holding: Holding) => Effect.Effect<void>;
}
