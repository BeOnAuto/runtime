import { setImmediate as nextTurn } from 'node:timers/promises';

export async function onTheNextTurn<A>(work: () => A): Promise<A> {
  await nextTurn();
  return work();
}
