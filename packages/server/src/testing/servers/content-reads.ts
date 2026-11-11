import type { Ledger } from '@on.auto/operations';
import { Effect } from 'effect';

export interface ContentReads {
  readonly over: (ledger: Ledger['Service']) => Ledger['Service'];
  readonly reads: () => number;
  readonly fail: (failing: boolean) => void;
}

export function contentReads(): ContentReads {
  const counted = { reads: 0, failing: false };
  return {
    over: (ledger) => ({
      ...ledger,
      content: {
        ...ledger.content,
        get: (owner, sha256) =>
          Effect.suspend(() => {
            counted.reads += 1;
            return counted.failing
              ? Effect.die(new Error('The bucket did not answer'))
              : ledger.content.get(owner, sha256);
          }),
      },
    }),
    reads: () => counted.reads,
    fail: (failing) => {
      counted.failing = failing;
    },
  };
}
