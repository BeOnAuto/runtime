import type { Effect, Redacted } from 'effect';

import type { CustodianRefused } from '../custodians/custodian-refused.ts';
import type { Holding } from '../rows/secret-rows.ts';
import type { KeeperUnavailable } from './keeper-unavailable.ts';
import type { SecretKeyUnknown } from './secret-key-unknown.ts';

export type KeepingFailure = CustodianRefused | KeeperUnavailable;

export type ReadingFailure = SecretKeyUnknown | KeepingFailure;

export interface Keeper {
  readonly name: string;
  readonly hold: (id: string, value: Redacted.Redacted) => Effect.Effect<Holding, KeepingFailure>;
  readonly reveal: (holding: Holding) => Effect.Effect<Redacted.Redacted, ReadingFailure>;
  readonly release: (holding: Holding) => Effect.Effect<void>;
}
