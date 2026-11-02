import type { KeyedProjection, Ledger, ProjectedKeyedRow, ProjectedRowsQuery } from '@on.auto/operations';
import {
  remarkFacts,
  remarkRows,
  runFacts,
  runTallyRows,
  tallyDueAfterMs,
  topicFacts,
  topicRows,
  type RemarkFact,
  type RunFact,
  type TopicFact,
} from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

type AnyLedger = Ledger['Service'];

type ProjectingLedger = (projections: readonly KeyedProjection[]) => Promise<AnyLedger>;

const alpha = { org: 'acme', playbook: 'alpha' };

const acme = { org: 'acme' };

const nine = Date.parse('2026-10-01T09:00:00.000Z');

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 10 };

function made(text: string): RemarkFact {
  return { type: 'remark_made', data: { text } };
}

function remarked(ledger: AnyLedger, stream: string, ...facts: readonly RemarkFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, remarkFacts, facts));
}

function began(minutes: number): RunFact {
  return { type: 'run_began', data: { at: new Date(nine + minutes * 60_000).toISOString(), fn: 'triage' } };
}

function topics(ledger: AnyLedger, stream: string, ...facts: readonly TopicFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, topicFacts, facts));
}

function addressesOf(rows: readonly ProjectedKeyedRow[]) {
  return rows.map(({ org, playbook, key }) => [org, playbook, key]);
}

function rowsUnderTheirAddresses(open: ProjectingLedger): void {
  describe('a projection of the streams of playbooks and of orgs', () => {
    it('keeps each row under its address, reads and counts the rows of one, and keeps none that folds to nothing', async () => {
      const ledger = await open([remarkRows]);
      await remarked(ledger, 'playbook/acme/alpha/remarks/r1', made('of alpha'));
      await remarked(ledger, 'org/acme/remarks/r1', made('of acme'));
      await remarked(ledger, 'org/acme/remarks/r2', { type: 'remark_erased', data: { position: 1 } });
      await remarked(ledger, 'org/globex/remarks/r1', made('of globex'));
      await remarked(ledger, 'org/acme/remarks', made('of no stream of a kind'));

      const ofAcme = await Effect.runPromise(ledger.readProjectedRows('remarks', acme, everyRow));
      const ofAlpha = await Effect.runPromise(ledger.readProjectedRows('remarks', alpha, everyRow));

      expect(ofAcme.map(({ row }) => row['text'])).toEqual(['of acme']);
      expect(ofAcme).toMatchObject([{ org: 'acme', key: 'r1' }]);
      expect(ofAcme.map((row) => 'playbook' in row)).toEqual([false]);
      expect(ofAlpha.map(({ row }) => row['text'])).toEqual(['of alpha']);
      expect(await Effect.runPromise(ledger.countProjectedRows('remarks', acme, []))).toBe(1);
    });

    it('keeps nothing of a scope it does not name, a playbook’s streams alone when it names none', async () => {
      const ledger = await open([runTallyRows, { ...remarkRows, scopes: ['org'] }]);
      await Effect.runPromise(ledger.execute('org/acme/runs/r1', runFacts, [began(0)]));
      await remarked(ledger, 'playbook/acme/alpha/remarks/r1', made('of alpha'));

      expect(await Effect.runPromise(ledger.countProjectedRows('run_tallies', acme, []))).toBe(0);
      expect(await Effect.runPromise(ledger.countProjectedRows('remarks', alpha, []))).toBe(0);
    });
  });
}

function rowsDueAndAdvanced(open: ProjectingLedger): void {
  describe('the rows of a projection of the streams of orgs, due and advanced', () => {
    it('are read due beside the rows of playbooks, under their addresses, the soonest first', async () => {
      const ledger = await open([{ ...runTallyRows, scopes: ['playbook', 'org'] }]);
      await Effect.runPromise(ledger.execute('playbook/acme/alpha/runs/r1', runFacts, [began(1)]));
      await Effect.runPromise(ledger.execute('org/acme/runs/r2', runFacts, [began(0)]));

      const due = await Effect.runPromise(
        ledger.readDueRows('run_tallies', { column: 'due_at', through: nine + 2 * tallyDueAfterMs, limit: 5 }),
      );

      expect(addressesOf(due)).toEqual([
        ['acme', undefined, 'r2'],
        ['acme', 'alpha', 'r1'],
      ]);
    });

    it('are keyed by their mapping over the kinds of an org, several by one append, and advanced under the org', async () => {
      const ledger = await open([{ ...topicRows, scopes: ['org'] }]);
      await topics(
        ledger,
        'org/acme/runs/r1',
        { type: 'topic_opened', data: { topic: 'spring', at: nine } },
        { type: 'topic_opened', data: { topic: 'autumn', at: nine } },
      );
      await topics(ledger, 'org/acme/notes/n1', { type: 'topic_noted', data: { topic: 'spring', note: 'of acme' } });

      await Effect.runPromise(ledger.advanceRow('topics', acme, 'spring', { set: { open: false }, when: [] }));
      const rows = await Effect.runPromise(ledger.readProjectedRows('topics', acme, everyRow));

      expect(rows.map(({ key, row }) => [key, row['note'], row['open']])).toEqual([
        ['autumn', null, true],
        ['spring', 'of acme', false],
      ]);
    });
  });
}

export function orgProjectionsBehaviour(open: ProjectingLedger): void {
  rowsUnderTheirAddresses(open);
  rowsDueAndAdvanced(open);
}
