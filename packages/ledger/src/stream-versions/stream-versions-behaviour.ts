import { describe, expect, it } from 'vitest';

import { stamped } from '../testing/happenings.ts';
import { aStore, type LedgerEntry } from '../testing/ledger-entry.ts';

const run = 'run/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const counted = (n: number) => ({ type: 'counted', data: { n } });

export function streamVersionsBehaviour(entry: LedgerEntry): void {
  describe('a stream read at a version', () => {
    it('answers the version of its last fact, and none for a stream never appended to', async () => {
      const store = await aStore(entry);
      await store.append(run, [counted(1), counted(2)], { expectedVersion: 0, context: stamped });
      await store.append(run, [counted(3)], { expectedVersion: 2, context: stamped });

      expect([await store.versionOf(run), await store.versionOf('run/nobody-wrote')]).toEqual([3, 0]);
    });

    it('reads the one fact at a version, with its data and context, and nothing before the first or past the last', async () => {
      const store = await aStore(entry);
      await store.append(run, [counted(1), counted(2), counted(3)], { expectedVersion: 0, context: stamped });

      const [first, last] = [await store.messageAt(run, 1), await store.messageAt(run, 3)];

      expect([first?.data, first?.context, last?.data, last?.lineage.id]).toEqual([
        { n: 1 },
        stamped,
        { n: 3 },
        (await store.read(run, 2)).messages[0]?.lineage.id,
      ]);
      expect([
        await store.messageAt(run, 0),
        await store.messageAt(run, 4),
        await store.messageAt('run/nobody-wrote', 1),
      ]).toEqual([undefined, undefined, undefined]);
    });

    it('reads the last fact of a stream in one statement, as the read of the whole stream answers it, and none of a stream never appended to', async () => {
      const store = await aStore(entry);
      await store.append(run, [counted(1), counted(2)], { expectedVersion: 0, context: stamped });
      await store.append(run, [counted(3)], { expectedVersion: 2, context: stamped });

      expect([await store.lastMessageOf(run), await store.lastMessageOf('run/nobody-wrote')]).toEqual([
        (await store.read(run, 0)).messages.at(-1),
        undefined,
      ]);
    });
  });
}
