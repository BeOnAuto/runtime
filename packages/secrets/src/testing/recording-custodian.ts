import { randomBytes } from 'node:crypto';

import { Effect, Redacted } from 'effect';

import { custodianRefused, type CustodianAct } from '../custodians/custodian-refused.ts';
import type { Custodian } from '../custodians/custodian.ts';
import { localCustodian } from '../custodians/local-custodian.ts';
import type { KeepingFailure } from '../keepers/keeper.ts';

export interface RecordingCustodian extends Custodian {
  readonly wraps: () => number;
  readonly unwraps: () => number;
  readonly dataKeys: () => readonly Readonly<Uint8Array>[];
  readonly refuse: () => void;
  readonly stall: () => Promise<void>;
  readonly answer: () => void;
}

type Answering =
  | { readonly by: 'answering' }
  | { readonly by: 'refusing' }
  | { readonly by: 'stalling'; readonly asked: () => void };

interface Answers extends Pick<RecordingCustodian, 'refuse' | 'stall' | 'answer'> {
  readonly answered: <A>(
    act: CustodianAct,
    answer: Effect.Effect<A, KeepingFailure>,
  ) => Effect.Effect<A, KeepingFailure>;
}

export const custodianRefusal = 'the key is disabled';

function aSecretsKey(): Redacted.Redacted<Uint8Array> {
  return Redacted.make(new Uint8Array(randomBytes(32)));
}

function answersOf(kid: string): Answers {
  const now: { answering: Answering } = { answering: { by: 'answering' } };
  return {
    answered: (act, answer) => {
      const { answering } = now;
      if (answering.by === 'refusing') {
        return Effect.fail(custodianRefused(kid, act, custodianRefusal));
      }
      if (answering.by === 'stalling') {
        answering.asked();
        return Effect.never;
      }
      return answer;
    },
    refuse: () => {
      now.answering = { by: 'refusing' };
    },
    stall: () =>
      new Promise<void>((resolve) => {
        now.answering = {
          by: 'stalling',
          asked: () => {
            resolve();
          },
        };
      }),
    answer: () => {
      now.answering = { by: 'answering' };
    },
  };
}

export function recordingCustodian(custodian: Custodian = localCustodian(aSecretsKey())): RecordingCustodian {
  const { answered, refuse, stall, answer } = answersOf(custodian.kid);
  const asked = { wraps: 0, unwraps: 0 };
  const dataKeys: Readonly<Uint8Array>[] = [];
  const noted = (dataKey: Redacted.Redacted<Uint8Array>) =>
    Effect.sync(() => {
      dataKeys.push(Redacted.value(dataKey));
    });
  return {
    kid: custodian.kid,
    wrap: (dataKey) =>
      Effect.suspend(() => {
        asked.wraps += 1;
        return Effect.andThen(noted(dataKey), answered('wrap', custodian.wrap(dataKey)));
      }),
    unwrap: (wrapped) =>
      Effect.suspend(() => {
        asked.unwraps += 1;
        return Effect.tap(answered('unwrap', custodian.unwrap(wrapped)), noted);
      }),
    wraps: () => asked.wraps,
    unwraps: () => asked.unwraps,
    dataKeys: () => [...dataKeys],
    refuse,
    stall,
    answer,
  };
}
