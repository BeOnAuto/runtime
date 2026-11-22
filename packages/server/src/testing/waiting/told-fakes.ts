import { somethingHappened } from './happenings.ts';

/** What a fake MCP server records, and its way to answer once a read of it holds. */
interface Watched {
  readonly once: (holds: () => boolean) => Promise<void>;
  readonly seen: () => readonly unknown[];
  readonly received: () => readonly unknown[];
}

/**
 * The fake MCP server, telling the waits of each request it sees and each call it receives, as it records them: a
 * wait on what a server asked of it, or on the server's work once it answered, reads again then.
 */
export function receiptsTold<Fake extends Watched>(fake: Fake): Fake {
  const counted = (): number => fake.seen().length + fake.received().length;
  const toldAfter = (seen: number): void => {
    void fake
      .once(() => counted() !== seen)
      .then(() => {
        const now = counted();
        somethingHappened();
        toldAfter(now);
        return now;
      });
  };
  toldAfter(counted());
  return fake;
}
