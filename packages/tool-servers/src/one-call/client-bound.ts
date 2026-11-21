import { Result } from 'effect';

import { timerOf, type Timing } from '../bounds/call-bounds.ts';
import { raceAgainst } from '../bounds/timers.ts';
import { takenSlot, type ServerSlot } from '../calls/server-slot.ts';
import { failureOf, type ServerFailure } from '../clients/server-failures.ts';
import type { ServerLink } from '../clients/server-links.ts';

export type Taken = { readonly slot: ServerSlot } | { readonly failure: ServerFailure } | { readonly late: true };

const late: Taken = { late: true };

function releasedIfTaken(after: Taken): Promise<void> {
  return 'slot' in after ? after.slot.release() : Promise.resolve();
}

async function slotOf(link: ServerLink): Promise<Taken> {
  const taken = await takenSlot(link);
  return Result.isSuccess(taken) ? { slot: taken.success } : { failure: taken.failure };
}

export async function takenWithin(link: ServerLink, timing: Pick<Timing, 'openMs' | 'timer'>): Promise<Taken> {
  const opening = slotOf(link);
  const taken = await raceAgainst(timerOf(timing), timing.openMs, opening, late);
  if ('late' in taken) {
    void opening.then((after) => releasedIfTaken(after));
  }
  return taken;
}

const lateRestart: unique symbol = Symbol('a restart that did not come in time');

export function boundedSlot(slot: ServerSlot, timing: Pick<Timing, 'openMs' | 'timer'>): ServerSlot {
  const { openMs } = timing;
  const bound = timerOf(timing);
  return {
    ...slot,
    reopenOnce: () => raceAgainst(bound, openMs, slot.reopenOnce(), false),
    restartIfExited: async () => {
      const restart = await raceAgainst(bound, openMs, slot.restartIfExited(), lateRestart);
      if (restart === lateRestart) {
        throw new Error(`The MCP server process did not start again within ${openMs} ms`);
      }
      return restart;
    },
  };
}

export async function restartedIfExited(slot: ServerSlot): Promise<ServerFailure | undefined> {
  const restart = await slot.restartIfExited().catch((error: unknown) => failureOf(error));
  return typeof restart === 'string' ? undefined : restart;
}
