import type { KeyedProjection, Ledger } from '@on.auto/operations';
import { runFacts, runTallyRows, tallyDueAfterMs, type RunFact } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

type AnyLedger = Ledger['Service'];

type ProjectingLedger = (projections: readonly KeyedProjection[]) => Promise<AnyLedger>;

const nine = Date.parse('2026-10-01T09:00:00.000Z');

const minute = 60_000;

const ended: RunFact = { type: 'run_ended', data: { status: 'succeeded', ms: 10, tokens: null } };

function noting(ledger: AnyLedger, stream: string, ...facts: readonly RunFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, runFacts, facts));
}

function began(fn: string, minutes = 0): RunFact {
  return { type: 'run_began', data: { at: new Date(nine + minutes * minute).toISOString(), fn } };
}

function rowsDue(open: ProjectingLedger): void {
  describe('a read of the rows due by a time', () => {
    it('reads the rows of every playbook whose time is set and has come, none outside them, the soonest first, and the next time', async () => {
      const ledger = await open([runTallyRows]);
      await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage', 2));
      await noting(ledger, 'playbook/globex/gamma/runs/r2', began('triage', 0));
      await noting(ledger, 'playbook/acme/beta/runs/r3', began('triage', 1), ended);
      await noting(ledger, 'org/acme/alpha/runs/r4', began('triage', 0));
      const due = async (through: number, limit = 10) =>
        (await Effect.runPromise(ledger.readDueRows('run_tallies', { column: 'due_at', through, limit }))).map(
          ({ org, playbook, key }) => [org, playbook, key],
        );

      expect(await due(nine + 3 * minute)).toEqual([
        ['globex', 'gamma', 'r2'],
        ['acme', 'alpha', 'r1'],
      ]);
      expect(await due(nine + tallyDueAfterMs)).toEqual([['globex', 'gamma', 'r2']]);
      expect(await due(nine + 3 * minute, 1)).toEqual([['globex', 'gamma', 'r2']]);
      expect(await due(nine)).toEqual([]);
      expect(await Effect.runPromise(ledger.nextDueOf('run_tallies', 'due_at', 0))).toBe(nine + tallyDueAfterMs);
      expect(await Effect.runPromise(ledger.nextDueOf('run_tallies', 'due_at', nine + tallyDueAfterMs))).toBe(
        nine + 3 * minute,
      );
    });
  });
}

const firstTwoDue = { column: 'due_at', through: nine + 3 * minute, limit: 2 };

function rowsDueOneAPlaybook(open: ProjectingLedger): void {
  describe('a read of the rows due by a time, one a playbook', () => {
    it('reads only the soonest row of each playbook, so its limit counts playbooks', async () => {
      const ledger = await open([runTallyRows]);
      await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage', 1));
      await noting(ledger, 'playbook/acme/alpha/runs/r2', began('triage', 0));
      await noting(ledger, 'playbook/acme/alpha/runs/r3', began('triage', 0));
      await noting(ledger, 'playbook/globex/gamma/runs/r4', began('triage', 2));
      const due = async (onePerPlaybook: boolean) =>
        (await Effect.runPromise(ledger.readDueRows('run_tallies', { ...firstTwoDue, onePerPlaybook }))).map(
          ({ playbook, key }) => [playbook, key],
        );

      expect(await due(true)).toEqual([
        ['alpha', 'r2'],
        ['gamma', 'r4'],
      ]);
      expect(await due(false)).toEqual([
        ['alpha', 'r2'],
        ['alpha', 'r3'],
      ]);
    });
  });
}

export function dueRowsBehaviour(open: ProjectingLedger): void {
  rowsDue(open);
  rowsDueOneAPlaybook(open);
}
