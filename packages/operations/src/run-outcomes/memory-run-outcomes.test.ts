import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  runStreamOf,
  type RunOutcomeGroup,
  type RunOutcomeMapping,
  type RunOutcomeSelection,
  type RunOutcomeWindow,
} from '../index.ts';
import { memoryLedger, type MemoryLedger } from '../testing/memory-ledger.ts';
import { runFacts, runTallies, type RunFact } from './run-tallies.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const october: RunOutcomeWindow = { from: '2026-10-01', to: '2026-10-31' };

function noting(ledger: MemoryLedger, stream: string, ...facts: readonly RunFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.service.execute(stream, runFacts, facts));
}

function began(fn: string, at = '2026-10-01T09:00:00.000Z'): RunFact {
  return { type: 'run_began', data: { at, fn } };
}

function ended(status: 'succeeded' | 'failed' | 'rejected', ms: number | null, tokens: number | null = null): RunFact {
  return { type: 'run_ended', data: { status, ms, tokens } };
}

function reading(
  ledger: MemoryLedger,
  window: RunOutcomeWindow = october,
  selection: RunOutcomeSelection = {},
): Promise<readonly RunOutcomeGroup[]> {
  return Effect.runPromise(ledger.service.readRunOutcomes(alpha, window, selection));
}

function runsOf(groups: readonly RunOutcomeGroup[]): readonly string[] {
  return groups.map(({ day, name, status, runs }) => `${day} ${name} ${status} ${runs}`);
}

const failingOnAFailure: RunOutcomeMapping = {
  ...runTallies,
  rowAfter: (row, event) => {
    const kept = runTallies.rowAfter(row, event);
    if (kept?.status === 'failed') {
      throw new Error('The mapping broke down');
    }
    return kept;
  },
};

describe('a run stream', () => {
  it('is a stream named runs/<id> in a playbook, and nothing nested under it', () => {
    expect(
      [
        'playbook/acme/alpha/runs/r1',
        'playbook/acme/alpha/runs/r1/more',
        'playbook/acme/alpha/run-logs/r1',
        'playbook/acme/runs/r1',
        'playbook/acme/alpha/runs/',
      ].map((stream) => runStreamOf(stream)),
    ).toEqual([{ playbookKey: 'playbook/acme/alpha/', runId: 'r1' }, undefined, undefined, undefined, undefined]);
  });
});

describe('the outcomes of runs in the in-memory ledger', () => {
  it('are one row per run, from the mapping it is given, grouped by day, function and status', async () => {
    const ledger = memoryLedger(runTallies);
    await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage'), ended('succeeded', 120, 40));
    await noting(ledger, 'playbook/acme/alpha/runs/r2', began('triage'));
    await noting(ledger, 'playbook/acme/alpha/runs/r2', ended('succeeded', 80, 2));
    await noting(ledger, 'playbook/acme/alpha/runs/r3', began('triage'), ended('rejected', null));
    await noting(ledger, 'playbook/acme/alpha/runs/r4', began('draft', '2026-10-02T23:59:59.999Z'));

    const groups = await reading(ledger);

    expect(runsOf(groups)).toEqual([
      '2026-10-01 triage succeeded 2',
      '2026-10-01 triage rejected 1',
      '2026-10-02 draft started 1',
    ]);
    expect(groups[0]).toMatchObject({ inputTokens: 42, outputTokens: 42, cachedTokens: 42, durations: [120, 80] });
    expect(groups[1]).toMatchObject({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, durations: [] });
  });

  it('keep to the days of the window, the selection and the playbook asked for', async () => {
    const ledger = memoryLedger(runTallies);
    await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage', '2026-09-30T23:59:59.999Z'));
    await noting(ledger, 'playbook/acme/alpha/runs/r2', began('triage', '2026-10-01T00:00:00.000Z'));
    await noting(ledger, 'playbook/acme/alpha/runs/r3', began('draft', '2026-10-01T00:00:00.000Z'));
    await noting(ledger, 'playbook/acme/alpha2/runs/r4', began('triage', '2026-10-01T00:00:00.000Z'));

    const pages = await Promise.all([
      reading(ledger, { from: '2026-10-01', to: '2026-10-01' }),
      reading(ledger, october, { name: 'draft' }),
      reading(ledger, october, { definitionType: 'other' }),
      reading(ledger, october, { definitionType: 'tally', name: 'triage' }),
    ]);

    expect(pages.map((groups) => runsOf(groups))).toEqual([
      ['2026-10-01 triage started 1', '2026-10-01 draft started 1'],
      ['2026-10-01 draft started 1'],
      [],
      ['2026-10-01 triage started 1'],
    ]);
  });
});

describe('what the in-memory ledger keeps no outcome of', () => {
  it('is another stream, another type, and an event the mapping keeps nothing of', async () => {
    const ledger = memoryLedger(runTallies);
    await noting(ledger, 'playbook/acme/alpha/run-logs/r1', began('triage'));
    await noting(ledger, 'playbook/acme/alpha/runs/r2', ended('failed', 5), { type: 'run_noted', data: {} });

    expect(await reading(ledger)).toEqual([]);
  });

  it('is anything, without a mapping', async () => {
    const ledger = memoryLedger();
    await noting(ledger, 'playbook/acme/alpha/runs/r1', began('triage'));

    expect(await reading(ledger)).toEqual([]);
  });

  it('is an append whose mapping breaks down, which is not kept either', async () => {
    const ledger = memoryLedger(failingOnAFailure);

    const appended = await Effect.runPromise(
      Effect.exit(
        ledger.service.execute('playbook/acme/alpha/runs/r1', runFacts, [began('triage'), ended('failed', 5)]),
      ),
    );

    expect(Exit.hasDies(appended)).toBe(true);
    expect([await reading(ledger), ledger.streamNames()]).toEqual([[], []]);
  });
});
