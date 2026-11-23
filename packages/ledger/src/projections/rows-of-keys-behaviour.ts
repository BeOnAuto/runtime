import { projectedTableOf, type KeptProjection, type Ledger } from '@on.auto/operations';
import { labelRows, remarkFacts, remarkRows, type RemarkFact } from '@on.auto/operations/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { storeReadsTally } from '../store-reads/store-reads.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';

type AnyLedger = Ledger['Service'];

type ProjectingLedger = (projections: readonly KeptProjection[]) => Promise<AnyLedger>;

const alpha = { org: 'acme', playbook: 'alpha' };

const remarksTable = projectedTableOf(remarkRows);

function made(text: string): RemarkFact {
  return { type: 'remark_made', data: { text } };
}

function remarked(ledger: AnyLedger, stream: string, text: string): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, remarkFacts, [made(text)]));
}

async function threeRemarks(open: ProjectingLedger): Promise<AnyLedger> {
  const ledger = await open([remarkRows, labelRows]);
  await remarked(ledger, 'playbook/acme/alpha/remarks/r1', 'first');
  await remarked(ledger, 'playbook/acme/alpha/remarks/r2', 'second');
  await remarked(ledger, 'playbook/acme/beta/remarks/r3', 'of beta');
  return ledger;
}

export function rowsOfKeysBehaviour(open: ProjectingLedger): void {
  describe('the rows of a projection read by a list of keys', () => {
    it('answer each key asked in its order, and nothing for a key with no row under the address', async () => {
      const ledger = await threeRemarks(open);

      const rows = await Effect.runPromise(ledger.readProjectedRowsOfKeys('remarks', alpha, ['r2', 'r3', 'r1', 'r9']));

      expect(rows.map((row) => row?.row['text'])).toEqual(['second', undefined, 'first', undefined]);
      expect(rows[0]).toMatchObject({ org: 'acme', playbook: 'alpha', key: 'r2' });
    });

    it('answer no key with nothing, reading no statement, a projection the store does not keep with nothing for each key, and refuse one of child rows', async () => {
      const ledger = await threeRemarks(open);
      const tally = storeReadsTally();

      const none = await tally.run(() => Effect.runPromise(ledger.readProjectedRowsOfKeys('remarks', alpha, [])));
      const unkept = await Effect.runPromise(ledger.readProjectedRowsOfKeys('elsewhere', alpha, ['r1', 'r2']));
      const children = await Effect.runPromiseExit(ledger.readProjectedRowsOfKeys('labels', alpha, ['r1']));

      expect([none, unkept, Exit.hasDies(children)]).toEqual([[], [undefined, undefined], true]);
      expect(tally.taken()).toEqual({});
    });

    it('answer what reads taken together answer, within reads taken together too, and fail as their reads fail', async () => {
      const ledger = await threeRemarks(open);
      const counted = ledger.countProjectedRows('remarks', alpha, []);

      const read = await Effect.runPromise(ledger.readTogether(ledger.readTogether(counted)));
      const failed = await Effect.runPromise(Effect.flip(ledger.readTogether(Effect.flatMap(counted, Effect.fail))));

      expect([read, failed]).toEqual([2, 2]);
    });
  });
}

async function manyReadTogether(open: ProjectingLedger): Promise<readonly (readonly number[])[]> {
  const ledger = await threeRemarks(open);
  const each = ledger.readTogether(
    Effect.gen(function* () {
      const before = yield* ledger.countProjectedRows('remarks', alpha, []);
      const names = yield* ledger.namesHeldIn({ playbookKey: 'playbook/acme/alpha/', definitionType: 'workflow' });
      return [before, names.length];
    }),
  );

  return Effect.runPromise(
    Effect.all(
      Array.from({ length: 64 }, () => each),
      { concurrency: 'unbounded' },
    ),
  );
}

export function rowsReadTogetherOnStoresBehaviour(entry: LedgerEntry): void {
  const open: ProjectingLedger = (projections) => aLedger(entry, undefined, undefined, projections);
  describe.skipIf(entry.readsAsTheyCome === true)('the rows of a projection read together on the store', () => {
    it('are read by a list of keys in one statement', async () => {
      const ledger = await threeRemarks(open);
      const tally = storeReadsTally();

      await tally.run(() => Effect.runPromise(ledger.readProjectedRowsOfKeys('remarks', alpha, ['r2', 'r3', 'r1'])));

      expect(tally.taken()).toEqual({ [remarksTable]: { n: 1, rows: 2 } });
    });

    it('are read at the one position of their first read, and none of an append made between them', async () => {
      const ledger = await threeRemarks(open);
      const counted = ledger.countProjectedRows('remarks', alpha, []);

      const together = await Effect.runPromise(
        ledger.readTogether(
          Effect.gen(function* () {
            const before = yield* counted;
            yield* Effect.promise(() => remarked(ledger, 'playbook/acme/alpha/remarks/r4', 'fourth'));
            const keyed = yield* ledger.readProjectedRowsOfKeys('remarks', alpha, ['r1', 'r4']);
            return [before, yield* counted, keyed.map((row) => row?.key)];
          }),
        ),
      );

      expect([...together, await Effect.runPromise(counted)]).toEqual([2, 2, ['r1', undefined], 3]);
    });

    it('answer when more are taken together at once than the store has readers, each reading outside them too', async () => {
      expect(await manyReadTogether(open)).toEqual(Array.from({ length: 64 }, () => [2, 0]));
    });
  });
}
