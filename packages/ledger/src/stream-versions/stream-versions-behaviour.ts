import type { StreamReader } from '@on.auto/operations';
import { RemarkFactSchema, remarkFacts, remarkedContext } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { streamPortsOf } from '../ledger-service.ts';
import { stamped } from '../testing/happenings.ts';
import { aLedger, aStore, type LedgerEntry } from '../testing/ledger-entry.ts';

const run = 'run/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const counted = (n: number) => ({ type: 'counted', data: { n } });

const remarks = 'playbook/acme/alpha/remarks/r1';

const twoRemarks = [
  { type: 'remark_made', data: { text: 'first' } },
  { type: 'remark_made', data: { text: 'second' } },
] as const;

const theSecondAlone = [
  { type: 'remark_made', data: { text: 'second' }, context: remarkedContext },
  undefined,
  undefined,
  undefined,
];

async function readAt(factAt: StreamReader['factAt']) {
  const at = (position: number) => Effect.runPromise(factAt(remarks, position, RemarkFactSchema));
  return [await at(2), await at(0), await at(3), await at(1.5)];
}

function factsAtTheirPositions(entry: LedgerEntry): void {
  describe('a fact read at its position', () => {
    it('is read by the ledger as the one message at it, decoded as a load decodes it, and none before the first or past the last', async () => {
      const ledger = await aLedger(entry);
      await Effect.runPromise(ledger.execute(remarks, remarkFacts, twoRemarks));

      expect(await readAt(ledger.factAt)).toEqual(theSecondAlone);
    });

    it('is read over any streams as a page of one fact, as streams lent across a boundary are read', async () => {
      const ports = streamPortsOf(await aStore(entry));
      await Effect.runPromise(ports.execute(remarks, remarkFacts, twoRemarks));

      expect(await readAt(ports.factAt)).toEqual(theSecondAlone);
    });
  });
}

export function streamVersionsBehaviour(entry: LedgerEntry): void {
  factsAtTheirPositions(entry);
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
