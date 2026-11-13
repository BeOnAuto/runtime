import { textToKeep } from '@on.auto/content';
import { alpha, json, resultOf } from '@on.auto/content/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { layoutIn } from '../layout/ledger-layout-behaviour.ts';
import { ledgerLayout, ledgerLayoutFloor } from '../layout/ledger-layout.ts';
import { ledgerLayoutSteps } from '../layout/ledger-steps.ts';
import { structureIn } from '../structure/database-structure-behaviour.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';

const HeadRows = Schema.Array(
  Schema.Struct({ kept_at: Schema.Number, kept_in: Schema.String, removing_since: Schema.Null }),
);

const EveryColumnOfTheHead = Schema.Tuple([Schema.Record(Schema.String, Schema.Unknown)]);

const theClocksApartMs = 1000;

const theLayoutOfTheHeads = 12;

const theLayoutOfTheExpiry = 21;

const columnsOfTheExpiry = ['expires_at', 'erased_at'];

const theIndexOfTheExpiry = 'recorded_content_heads_expiring';

const everyHead = 'SELECT * FROM recorded_content_heads';

const carryingToTheExpiry = { kept: theLayoutOfTheExpiry, floor: ledgerLayoutFloor, steps: ledgerLayoutSteps };

const carryingOnToTheLayoutKept = { kept: ledgerLayout, floor: ledgerLayoutFloor, steps: ledgerLayoutSteps };

async function headsKeptIn(entry: LedgerEntry, database: string): Promise<void> {
  const ledger = await aLedger(entry, database);
  await resultOf(ledger.content.put(alpha, textToKeep('{"kept":"before the step"}', json)));
}

async function theExpiryTakenAwayFrom(entry: LedgerEntry, database: string): Promise<void> {
  await entry.queried(database, `DROP INDEX ${theIndexOfTheExpiry}`);
  await entry.queried(database, 'ALTER TABLE recorded_content_heads DROP COLUMN erased_at');
  await entry.queried(database, 'ALTER TABLE recorded_content_heads DROP COLUMN expires_at');
}

async function headsAtTheLayoutBefore(entry: LedgerEntry, database: string): Promise<void> {
  await headsKeptIn(entry, database);
  await theExpiryTakenAwayFrom(entry, database);
  await entry.queried(database, 'ALTER TABLE recorded_content_heads DROP COLUMN removing_since');
  await entry.queried(database, 'ALTER TABLE recorded_content_heads DROP COLUMN kept_in');
  await entry.queried(database, 'ALTER TABLE recorded_content_heads DROP COLUMN kept_at');
  await entry.queried(database, `UPDATE ledger_layout SET layout = ${String(theLayoutOfTheHeads - 1)}`);
}

async function theHeadIn(entry: LedgerEntry, database: string): Promise<Readonly<Record<string, unknown>>> {
  const [head] = Schema.decodeUnknownSync(EveryColumnOfTheHead)(await entry.queried(database, everyHead));
  return head;
}

function keptTimeBehaviour(entry: LedgerEntry): void {
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

function expiryBehaviour(entry: LedgerEntry): void {
  describe('the step that gives the heads of recorded content the time their content expires and the time its bytes were erased', () => {
    it('adds both last, empty, to the head of a database of the layout before it, so the head reads as it did, and the database then opens as a new one, the index of the heads that expire made as it opens', async () => {
      const database = await entry.aDatabase();
      await headsKeptIn(entry, database);
      const made = await structureIn(entry, database);
      await theExpiryTakenAwayFrom(entry, database);
      await entry.queried(database, `UPDATE ledger_layout SET layout = ${String(theLayoutOfTheExpiry - 1)}`);
      const before = await theHeadIn(entry, database);

      await entry.carriedOn(database, carryingToTheExpiry);
      const after = await theHeadIn(entry, database);
      const carried = {
        layout: (await layoutIn(entry, database)).layout,
        structure: await structureIn(entry, database),
      };
      await entry.carriedOn(database, carryingOnToTheLayoutKept);
      await aLedger(entry, database);

      expect(after).toEqual({ ...before, expires_at: null, erased_at: null });
      expect(Object.keys(after)).toEqual([...Object.keys(before), ...columnsOfTheExpiry]);
      expect(carried.layout).toBe(theLayoutOfTheExpiry);
      expect(Object.keys(carried.structure.indexes)).not.toContain(theIndexOfTheExpiry);
      expect(Object.keys(made.indexes)).toContain(theIndexOfTheExpiry);
      expect(await structureIn(entry, database)).toEqual(made);
    });

    it('carries a database of the layout before whose first opening ended before the ledger made its content tables, making the heads as they stood before the step, and the database then opens as a new one', async () => {
      const database = await entry.aDatabase();
      await aLedger(entry, database);
      const made = await structureIn(entry, database);
      await entry.queried(database, 'DROP TABLE recorded_content_heads');
      await entry.queried(database, 'DROP TABLE recorded_content_chunks');
      await entry.queried(database, `UPDATE ledger_layout SET layout = ${String(theLayoutOfTheExpiry - 1)}`);

      await entry.carriedOn(database, carryingToTheExpiry);
      const carriedTo = (await layoutIn(entry, database)).layout;
      await entry.carriedOn(database, carryingOnToTheLayoutKept);
      await aLedger(entry, database);

      expect(carriedTo).toBe(theLayoutOfTheExpiry);
      expect(await structureIn(entry, database)).toEqual(made);
    });
  });
}

export function headsStepBehaviour(entry: LedgerEntry): void {
  keptTimeBehaviour(entry);
  expiryBehaviour(entry);
}
