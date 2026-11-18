import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { remarkedContext, remarkFacts, RemarkFactSchema } from '../projections/remark-rows.ts';
import { readPlaybookTallyRows, runTallyRows } from '../projections/tally-rows.ts';
import { type RunFact, runFacts } from '../run-outcomes/run-tallies.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toOrg } from '../testing/harness.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { playbookBoundStreamReader } from './bound-ports.ts';

describe('the stream reader bound to a playbook', () => {
  it('reads a stream of its own playbook by its name under the playbook', async () => {
    const asked: string[] = [];
    const ledger = memoryLedger().service;
    await Effect.runPromise(
      ledger.execute('playbook/acme/alpha/remarks/r1', remarkFacts, [{ type: 'remark_made', data: { text: 'first' } }]),
    );
    const reader = playbookBoundStreamReader(
      {
        ...ledger,
        factAt: (stream, position, eventSchema) =>
          Effect.andThen(
            Effect.sync(() => {
              asked.push(stream);
            }),
            ledger.factAt(stream, position, eventSchema),
          ),
      },
      { org: 'acme', playbook: 'alpha' },
    );

    const found = await Effect.runPromise(reader.factAt('remarks/r1', 1, RemarkFactSchema));

    expect([found, asked]).toEqual([
      { type: 'remark_made', data: { text: 'first' }, context: remarkedContext },
      ['playbook/acme/alpha/remarks/r1'],
    ]);
  });
});

const nine = Date.parse('2026-10-01T09:00:00.000Z');

function beganAt(minutes: number): RunFact {
  return { type: 'run_began', data: { at: new Date(nine + minutes * 60_000).toISOString(), fn: 'triage' } };
}

const runsOfEveryScope = [
  ['playbook/acme/alpha/runs/r1', 0],
  ['playbook/acme/alpha/runs/r2', 2],
  ['playbook/acme/alpha/runs/r3', 3],
  ['playbook/acme/beta/runs/r4', 4],
  ['playbook/globex/alpha/runs/r5', 5],
  ['org/acme/runs/r6', 6],
] as const;

describe('the read of the projected rows of one playbook of the org, bound to an org call', () => {
  it('reads and counts the rows of the playbook it names, and nothing of another playbook, org or the org itself', async () => {
    const { dispatcher: d, ledger, run } = harness({ projections: [{ ...runTallyRows, scopes: ['playbook', 'org'] }] });
    await Effect.runPromise(
      Effect.forEach(runsOfEveryScope, ([stream, minutes]) =>
        ledger.service.execute(stream, runFacts, [beganAt(minutes)]),
      ),
    );
    const readOf = (playbook: string, limit = 5) =>
      run(
        d.dispatchToOrg(readPlaybookTallyRows.registration, toOrg('acme')(acmeAdmin, { playbook, after: nine, limit })),
      );

    expect(await readOf('alpha')).toEqual({ status: 'succeeded', output: { runs: ['r3', 'r2'], began: 2 } });
    expect(await readOf('alpha', 1)).toEqual({ status: 'succeeded', output: { runs: ['r3'], began: 2 } });
    expect(await readOf('beta')).toEqual({ status: 'succeeded', output: { runs: ['r4'], began: 1 } });
    expect(await readOf('gamma')).toEqual({ status: 'succeeded', output: { runs: [], began: 0 } });
  });

  it('fails the call for a limit below one', async () => {
    const { dispatcher: d, reported, run } = harness({ projections: [runTallyRows] });

    expect(
      await run(
        d.dispatchToOrg(
          readPlaybookTallyRows.registration,
          toOrg('acme')(acmeAdmin, { playbook: 'alpha', after: nine, limit: 0 }),
        ),
      ),
    ).toMatchObject({ status: 'failed' });
    expect(reported().map(({ original }) => String(original))).toEqual([
      'RangeError: A read of projected rows takes a limit of 1 or more, not 0',
    ]);
  });
});
