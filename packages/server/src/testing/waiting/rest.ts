import { onTestFinished } from 'vitest';

/**
 * What a wait can hear from in the process: a server a test started, or a process it spawned. Each says when it is
 * wholly at rest, so that nothing more happens unless a test does something: a server on a stepped clock whose host
 * sleeps on it, every fiber, with no request in hand; a process that exited. A server on the system's clock never is,
 * since its timers fire by themselves.
 */
export interface Resting {
  /** Answers once it is at rest, as long as nothing wakes it; never, for what can act by itself. */
  readonly atRest: () => Promise<void>;
  /** Whether it has work in hand that a test began from outside, such as a request it has not answered. */
  readonly busy: () => boolean;
}

const watched = new Set<Resting>();

const never: Promise<void> = new Promise<void>(() => {});

/** What never rests, with the work it has in hand: a server on the system's clock. */
export function restless(busy: Resting['busy']): Resting {
  return { atRest: () => never, busy };
}

/** Hears from it until the returned function is called, as a server stops or a test ends. */
export function heardFrom(resting: Resting): () => void {
  watched.add(resting);
  return () => {
    watched.delete(resting);
  };
}

/**
 * Hears from a process the test spawned until the test ends: it acts by itself while it runs, and is at rest once it
 * exited, as nothing more comes of it then.
 */
export function heardUntilItExits(exited: Promise<unknown>): void {
  const settled = (async (): Promise<void> => {
    await exited.catch(() => 'exited');
  })();
  onTestFinished(heardFrom({ atRest: () => settled, busy: () => false }));
}

/** Its rest, or never where it cannot say, as a stepped clock no host was given cannot. */
function restOf(resting: Resting): Promise<void> {
  return resting.atRest().catch(() => never);
}

/**
 * Answers once everything a wait hears from is at rest at once, or never when nothing is heard from, as nothing then
 * says that nothing more will happen.
 */
export async function everythingAtRest(): Promise<void> {
  const all = [...watched];
  await (all.length === 0 ? never : Promise.all(all.map((resting) => restOf(resting))));
}

/** Whether anything heard from has work in hand. */
export function anythingBusy(): boolean {
  return [...watched].some((resting) => resting.busy());
}
