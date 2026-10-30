import { Conflict, type Ledger } from '@on.auto/operations';
import { Effect, Logger, type Layer } from 'effect';

export type Failing = 'conflict' | 'defect' | 'nothing';

interface FailingLedger {
  readonly ledger: (ledger: Ledger['Service']) => Ledger['Service'];
  readonly executesFail: (failure: Failing) => void;
}

const lostToOthers = new Conflict({ kind: 'concurrent_change', detail: 'Another change came first' });

export function failingLedger(): FailingLedger {
  const failing: { with: Failing } = { with: 'nothing' };
  return {
    ledger: (ledger) => ({
      ...ledger,
      execute: (stream, decider, command, lineage) => {
        if (failing.with === 'conflict') return Effect.fail(lostToOthers);
        if (failing.with === 'defect') return Effect.die(new Error('The ledger broke'));
        return ledger.execute(stream, decider, command, lineage);
      },
    }),
    executesFail: (failure) => {
      failing.with = failure;
    },
  };
}

export function capturedWarnings(): { readonly layer: Layer.Layer<never>; readonly lines: () => readonly string[] } {
  const lines: string[] = [];
  const capture = Logger.make(({ message }: { readonly message: unknown }) => {
    lines.push(String(message));
  });
  return { layer: Logger.layer([capture]), lines: () => [...lines] };
}
