import type { KeptProjection, Ledger, ProjectedRowsQuery } from '@on.auto/operations';
import {
  runFacts,
  runTallyRows,
  topicFacts,
  topicRows,
  type RunFact,
  type TopicFact,
} from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { topicsOf } from '../projections/projections-behaviour.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { checkpointsStepBehaviour } from './checkpoints-step-behaviour.ts';
import { aLedgerLogging } from './logged-opening.ts';

type AnyLedger = Ledger['Service'];

const alpha = { org: 'acme', playbook: 'alpha' };

const began: RunFact = { type: 'run_began', data: { at: '2026-10-01T09:00:00.000Z', fn: 'triage' } };

const opened: TopicFact = { type: 'topic_opened', data: { topic: 'spring', at: 1000 } };

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 100 };

export const checkpointsOfTheTallies =
  "SELECT projection, version, folded_through FROM projection_checkpoints WHERE projection = 'run_tallies' ORDER BY version";

export function caughtUpAt(version: number) {
  return { projection: 'run_tallies', version, folded_through: null };
}

function noting(ledger: AnyLedger, ...facts: readonly RunFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute('playbook/acme/alpha/runs/r1', runFacts, facts));
}

async function talliedOnce(entry: LedgerEntry, database: string): Promise<void> {
  await noting(await aLedger(entry, database, undefined, [runTallyRows]), began);
  await entry.queried(database, "DELETE FROM run_tallies_2 WHERE row_key = 'r1'");
}

async function talliesOf(ledger: AnyLedger): Promise<readonly string[]> {
  return (await Effect.runPromise(ledger.readProjectedRows('run_tallies', alpha, everyRow))).map(({ key }) => key);
}

const madeAgain = [{ level: 'WARN', annotations: { table: 'run_tallies_2' } }];

function aTableTrustedByItsRow(entry: LedgerEntry): void {
  it('is recorded as caught up, one row for its projection and version, once the ledger has filled it as it opens', async () => {
    const database = await entry.aDatabase();
    await noting(await aLedger(entry, database), began);

    await aLedger(entry, database, undefined, [runTallyRows]);

    expect(await entry.queried(database, checkpointsOfTheTallies)).toEqual([caughtUpAt(2)]);
  });

  it('is dropped and filled again where the ledger finds it with no row, which it logs as a warning naming the table', async () => {
    const database = await entry.aDatabase();
    await talliedOnce(entry, database);
    await entry.queried(database, "DELETE FROM projection_checkpoints WHERE projection = 'run_tallies'");

    const { ledger, logged } = await aLedgerLogging(entry, database, [runTallyRows]);

    expect([await talliesOf(ledger), logged]).toEqual([['r1'], madeAgain]);
    expect(await entry.queried(database, checkpointsOfTheTallies)).toEqual([caughtUpAt(2)]);
  });

  it('is carried on from the position its row holds, neither dropped nor logged, and its row then says caught up', async () => {
    const database = await entry.aDatabase();
    const first = await aLedger(entry, database, undefined, [runTallyRows]);
    await noting(first, began);
    await Effect.runPromise(first.execute('playbook/acme/alpha/runs/r2', runFacts, [began]));
    await entry.queried(database, "DELETE FROM run_tallies_2 WHERE row_key = 'r2'");
    await entry.queried(
      database,
      "UPDATE projection_checkpoints SET folded_through = '1' WHERE projection = 'run_tallies'",
    );

    const { ledger, logged } = await aLedgerLogging(entry, database, [runTallyRows]);

    expect([await talliesOf(ledger), logged]).toEqual([['r1', 'r2'], []]);
    expect(await entry.queried(database, checkpointsOfTheTallies)).toEqual([caughtUpAt(2)]);
  });
}

function aTableFilledOrLeftWhole(entry: LedgerEntry): void {
  it('is left whole, with the columns its reader advanced, where other tables are dropped and the rows beside them left, and the dropped tables are filled again', async () => {
    const database = await entry.aDatabase();
    const kept: readonly KeptProjection[] = [runTallyRows, topicRows];
    const first = await aLedger(entry, database, undefined, kept);
    await noting(first, began);
    await Effect.runPromise(first.execute('playbook/acme/alpha/runs/r2', topicFacts, [opened]));
    await Effect.runPromise(first.advanceRow('topics', alpha, 'spring', { set: { open: false }, when: [] }));
    await entry.queried(database, 'DROP TABLE run_tallies_2');

    const next = await aLedger(entry, database, undefined, kept);

    expect([(await topicsOf(next)).map(({ key, row }) => [key, row['open']]), await talliesOf(next)]).toEqual([
      [['spring', false]],
      ['r1'],
    ]);
  });
}

export function projectionCheckpointsBehaviour(entry: LedgerEntry): void {
  describe.skipIf(entry.itsOwnContractAlone === true)('the table of a projection, recorded beside it', () => {
    aTableTrustedByItsRow(entry);
    aTableFilledOrLeftWhole(entry);
  });
  checkpointsStepBehaviour(entry);
}
