import { isRunEndingType } from '@on.auto/definitions';
import type { AppendObserver } from '@on.auto/ledger';

export interface RunsInFlight extends AppendObserver {
  readonly count: () => number;
}

export function runsInFlight(): RunsInFlight {
  const unended = new Set<string>();
  return {
    appended: (stream, events) => {
      for (const { type } of events) {
        if (type === 'run_started') {
          unended.add(stream);
        } else if (isRunEndingType(type)) {
          unended.delete(stream);
        }
      }
    },
    count: () => unended.size,
  };
}
