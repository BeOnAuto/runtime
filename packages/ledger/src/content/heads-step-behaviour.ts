import { textToKeep } from '@on.auto/content';
import { alpha, json, resultOf } from '@on.auto/content/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ledgerLayoutFloor } from '../layout/ledger-layout.ts';
import { ledgerLayoutSteps } from '../layout/ledger-steps.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';

const HeadRows = Schema.Array(
  Schema.Struct({ kept_at: Schema.Number, kept_in: Schema.String, removing_since: Schema.Null }),
);

const theClocksApartMs = 1000;

const theLayoutOfTheHeads = 12;

async function headsAtTheLayoutBefore(entry: LedgerEntry, database: string): Promise<void> {
  const ledger = await aLedger(entry, database);
  await resultOf(ledger.content.put(alpha, textToKeep('{"kept":"before the step"}', json)));
  await entry.queried(database, 'ALTER TABLE recorded_content_heads DROP COLUMN removing_since');
  await entry.queried(database, 'ALTER TABLE recorded_content_heads DROP COLUMN kept_in');
  await entry.queried(database, 'ALTER TABLE recorded_content_heads DROP COLUMN kept_at');
  await entry.queried(database, `UPDATE ledger_layout SET layout = ${String(theLayoutOfTheHeads - 1)}`);
}

export function headsStepBehaviour(entry: LedgerEntry): void {
  describe('the step that gives the heads of recorded content the time they were kept', () => {
    it('gives each head of a database of the layout before it the moment of the step, by the clock of the database, as kept in the ledger and marked by no removal', async () => {
      const database = await entry.aDatabase();
      await headsAtTheLayoutBefore(entry, database);

      const before = Date.now();
      await entry.carriedOn(database, {
        kept: theLayoutOfTheHeads,
        floor: ledgerLayoutFloor,
        steps: ledgerLayoutSteps,
      });
      const after = Date.now();
      const heads = Schema.decodeUnknownSync(HeadRows)(
        await entry.queried(
          database,
          'SELECT CAST(kept_at AS DOUBLE PRECISION) AS kept_at, kept_in, removing_since FROM recorded_content_heads',
        ),
      );

      expect(heads.map(({ kept_in, removing_since }) => ({ kept_in, removing_since }))).toEqual([
        { kept_in: 'ledger', removing_since: null },
      ]);
      expect(heads[0]?.kept_at).toBeGreaterThanOrEqual(before - theClocksApartMs);
      expect(heads[0]?.kept_at).toBeLessThanOrEqual(after + theClocksApartMs);
    });
  });
}
