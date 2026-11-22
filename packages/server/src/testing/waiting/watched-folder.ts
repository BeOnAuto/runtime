import { watch } from 'node:fs';

import { somethingHappened } from './happenings.ts';
import { whenHeld } from './until.ts';

/** `until`, read again as well whenever something in the folder changes: a file another process writes there. */
export async function whenHeldIn<A>(
  folder: string,
  read: () => A | Promise<A>,
  holds: (value: A) => boolean,
): Promise<A> {
  const watcher = watch(folder, { recursive: true }, somethingHappened);
  try {
    return await whenHeld(read, holds);
  } finally {
    watcher.close();
  }
}
