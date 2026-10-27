import type { LogPorts } from '@on.auto/ledger';
import { Conflict, type Ledger } from '@on.auto/operations';
import { Effect, Logger, type Layer } from 'effect';

export type Failing = 'conflict' | 'defect' | 'nothing';

interface WatchedLog {
  readonly log: (log: LogPorts) => LogPorts;
  readonly eventsRead: () => number;
  readonly readsFail: () => void;
}

export function watchedLog(): WatchedLog {
  const watched = { events: 0, failing: false };
  const unless = <A>(read: () => Promise<A>) =>
    watched.failing ? Promise.reject(new Error('The ledger cannot be reached')) : read();
  return {
    log: (log) => ({
      ...log,
      at: (point) => unless(() => log.at(point)),
      after: async (point, most) => {
        const page = await unless(() => log.after(point, most));
        watched.events += page.events.length;
        return page;
      },
    }),
    eventsRead: () => watched.events,
    readsFail: () => {
      watched.failing = true;
    },
  };
}

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
