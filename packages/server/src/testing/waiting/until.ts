import { nextHappening, readByAWait } from './happenings.ts';
import { anythingBusy, everythingAtRest } from './rest.ts';

export { heardUntilItExits, somethingHappened } from './happenings.ts';
export { receiptsTold } from './told-fakes.ts';

export const longerThanTheTestMs = 120_000;

type Attempt<A> =
  | { readonly held: true; readonly value: A }
  | { readonly held: false; readonly value?: A; readonly failure?: unknown };

async function attempted<A>(read: () => A | Promise<A>, holds: (value: A) => boolean): Promise<Attempt<A>> {
  try {
    const value = await read();
    return holds(value) ? { held: true, value } : { held: false, value };
  } catch (failure) {
    return { held: false, failure };
  }
}

function always(): boolean {
  return true;
}

function shortly(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').slice(0, 300);
}

function lastSeen(attempt: Attempt<unknown>): string {
  if ('failure' in attempt) {
    return `the read failed: ${shortly(String(attempt.failure))}`;
  }
  return `it read ${shortly(JSON.stringify(attempt.value))}`;
}

/** The failure of a wait that nothing can end: every server and process it hears from is at rest, and it still does not hold. */
export class NothingMoreWillHappen extends Error {
  /** The last read: the value it read, or how it failed. */
  readonly last: Attempt<unknown>;

  constructor(read: () => unknown, holds: (value: never) => boolean, attempt: Attempt<unknown>) {
    super(
      [
        `Waited for ${shortly(String(holds))} of ${shortly(String(read))},`,
        'but every server and process the wait hears from is at rest, with nothing in hand, and it still did not hold:',
        `${lastSeen(attempt)}.`,
      ].join(' '),
    );
    this.name = 'NothingMoreWillHappen';
    this.last = attempt;
  }
}

interface Told {
  readonly next: Promise<'told'>;
  readonly yet: () => boolean;
}

function toldOnce(): Told {
  const told = { yet: false };
  const next = nextHappening().then(() => {
    told.yet = true;
    return 'told' as const;
  });
  return { next, yet: () => told.yet };
}

/**
 * The value once it holds. It holds no timeout of its own: it reads, and while the read does not hold it waits for
 * the next thing something else tells (see `somethingHappened`): an append, a request a test made, a fake's receipt, a
 * server's sleep, a process's output. What its own read asks of a server tells nothing. A read that throws, as an
 * `expect` does, is read again too. Once everything it hears from is at rest (see `heardFrom`) with nothing in hand
 * and the read still does not hold, nothing more can happen by itself, and it fails at once saying what it awaited.
 */
export function whenHeld<A>(check: () => A | Promise<A>): Promise<A>;
export function whenHeld<A>(read: () => A | Promise<A>, holds: (value: A) => boolean): Promise<A>;
export async function whenHeld<A>(read: () => A | Promise<A>, holds: (value: A) => boolean = always): Promise<A> {
  const reading = (): Promise<Attempt<A>> => readByAWait(() => attempted(read, holds));
  const told = toldOnce();
  const attempt = await reading();
  if (attempt.held) {
    return attempt.value;
  }
  const first = await Promise.race([told.next, everythingAtRest().then(() => 'rest' as const)]);
  if (first === 'rest' && !told.yet() && !anythingBusy()) {
    const atRest = await reading();
    if (atRest.held) {
      return atRest.value;
    }
    if (!told.yet() && !anythingBusy()) {
      throw new NothingMoreWillHappen(read, holds, atRest);
    }
  }
  await told.next;
  return whenHeld(read, holds);
}
