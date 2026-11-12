import { Ledger } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';

export interface WatchedLedger extends MemoryLedger {
  readonly asked: () => readonly string[];
  readonly failNextAppendTo: (stream: string) => void;
}

export const ledgerGone = 'The ledger went away';

export function watchedLedger(): WatchedLedger {
  const kept = memoryLedger();
  const asked: string[] = [];
  const failing = new Set<string>();
  const service = Ledger.of({
    ...kept.service,
    load: (stream, fold) =>
      Effect.suspend(() => {
        asked.push(`load ${stream}`);
        return kept.service.load(stream, fold);
      }),
    execute: (stream, decider, command, lineage) =>
      Effect.suspend(() => {
        asked.push(`execute ${stream}`);
        return failing.delete(stream)
          ? Effect.die(new Error(ledgerGone))
          : kept.service.execute(stream, decider, command, lineage);
      }),
  });
  return {
    service,
    layer: Layer.succeed(Ledger, service),
    streamNames: kept.streamNames,
    asked: () => [...asked],
    failNextAppendTo: (stream) => {
      failing.add(stream);
    },
  };
}
