import { randomBytes } from 'node:crypto';

import { Effect, Redacted } from 'effect';

import type { Custodian } from '../custodians/custodian.ts';
import { localCustodian } from '../custodians/local-custodian.ts';

export interface RecordingCustodian extends Custodian {
  readonly wraps: () => number;
  readonly unwraps: () => number;
  readonly dataKeys: () => readonly Readonly<Uint8Array>[];
  readonly refuse: () => void;
}

export const custodianRefusal = 'The custodian refuses to wrap or unwrap a data key';

export function aSecretsKey(): Redacted.Redacted<Uint8Array> {
  return Redacted.make(new Uint8Array(randomBytes(32)));
}

export function recordingCustodian(key: Redacted.Redacted<Uint8Array> = aSecretsKey()): RecordingCustodian {
  const custodian = localCustodian(key);
  const asked = { wraps: 0, unwraps: 0, refusing: false };
  const dataKeys: Readonly<Uint8Array>[] = [];
  const noted = (dataKey: Redacted.Redacted<Uint8Array>) =>
    Effect.sync(() => {
      dataKeys.push(Redacted.value(dataKey));
    });
  const answered = <A>(answer: Effect.Effect<A>): Effect.Effect<A> =>
    asked.refusing ? Effect.die(new Error(custodianRefusal)) : answer;
  return {
    kid: custodian.kid,
    wrap: (dataKey) =>
      Effect.suspend(() => {
        asked.wraps += 1;
        return Effect.andThen(noted(dataKey), answered(custodian.wrap(dataKey)));
      }),
    unwrap: (wrapped) =>
      Effect.suspend(() => {
        asked.unwraps += 1;
        return Effect.tap(answered(custodian.unwrap(wrapped)), noted);
      }),
    wraps: () => asked.wraps,
    unwraps: () => asked.unwraps,
    dataKeys: () => [...dataKeys],
    refuse: () => {
      asked.refusing = true;
    },
  };
}
