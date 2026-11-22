import { counted } from '@on.auto/phrasing';

import { Unavailable } from './unavailable.ts';

const mostBusyWaitSeconds = 8;

const doublings = Math.log2(mostBusyWaitSeconds);

export interface BusyWaits {
  readonly refused: () => number;
  readonly answered: () => void;
}

function busyWaits(): BusyWaits {
  const refusals = { inARow: 0 };
  return {
    refused: () => {
      const wait = 2 ** Math.min(refusals.inARow, doublings);
      refusals.inARow = Math.min(refusals.inARow + 1, doublings);
      return wait;
    },
    answered: () => {
      refusals.inARow = 0;
    },
  };
}

const waitsOfEachOwner = new WeakMap<object, BusyWaits>();

export function busyWaitsOf(owner: object): BusyWaits {
  const known = waitsOfEachOwner.get(owner);
  if (known !== undefined) {
    return known;
  }
  const waits = busyWaits();
  waitsOfEachOwner.set(owner, waits);
  return waits;
}

const second = { one: 'second', other: 'seconds' };

export function busyDetail(notDone: string, seconds: number): string {
  return `The server is busy, so ${notDone}. Try again in ${counted(seconds, second)}.`;
}

export function busyRefusal(notDone: string, seconds: number): Unavailable {
  return new Unavailable({ detail: busyDetail(notDone, seconds), kind: 'busy', retry_after: seconds });
}
