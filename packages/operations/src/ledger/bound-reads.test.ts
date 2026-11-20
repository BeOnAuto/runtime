import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { OrgReader, defineQuery, type RunOutcomeWindow } from '../index.ts';
import { placedIn } from '../projections-testing/definition-rows-behaviour.ts';
import { readTallyRows, runTallyRows } from '../projections/tally-rows.ts';
import { readRunTallies, runFacts, runTallies, type RunFact } from '../run-outcomes/run-tallies.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { harness, toOrg, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const NamesAskedSchema = Schema.Struct({ playbook: Schema.String, type: Schema.String });

const listNamesHeld = defineQuery('org', {
  name: 'list_names_held',
  title: 'List names held',
  description: 'Lists the names one playbook of the org holds, of one type of definition.',
  route: { method: 'GET', path: '/playbooks/{playbook}/names' },
  inputSchema: NamesAskedSchema,
  outputSchema: Schema.Struct({ names: Schema.Array(Schema.String) }),
  reasons: [],
  handle: ({ playbook, type }) =>
    Effect.map(
      OrgReader.use((reader) => reader.namesHeldInPlaybook(playbook, type)),
      (held) => ({ names: held.map(({ name }) => name) }),
    ),
});

const unreadableWindows: readonly (readonly [RunOutcomeWindow, string])[] = [
  [{ from: '2026-10-02', to: '2026-10-01' }, 'RangeError: The days from "2026-10-02" to "2026-10-01" are not a window'],
  [{ from: '2026-02-30', to: '2026-03-01' }, 'RangeError: The days from "2026-02-30" to "2026-03-01" are not a window'],
  [{ from: '2026-10-01', to: 'today' }, 'RangeError: The days from "2026-10-01" to "today" are not a window'],
];

describe('the read of the outcomes of runs, bound to a call', () => {
  it('reads only the playbook of the call', async () => {
    const { dispatcher: d, ledger, run } = harness({ runOutcomes: runTallies });
    const began: RunFact = { type: 'run_began', data: { at: '2026-10-01T09:00:00.000Z', fn: 'triage' } };
    await placedIn(ledger.service, 'triage', 'alpha');
    await placedIn(ledger.service, 'd2', 'beta');
    await Effect.runPromise(ledger.service.execute('definition/acme/triage/runs/r1', runFacts, [began]));
    await Effect.runPromise(ledger.service.execute('definition/acme/d2/runs/r2', runFacts, [began]));
    const window = { from: '2026-10-01', to: '2026-10-01' };

    const read = await run(d.dispatchToPlaybook(readRunTallies.registration, toAlpha(acmeAdmin, window)));
    const named = await run(
      d.dispatchToPlaybook(readRunTallies.registration, toAlpha(acmeAdmin, { ...window, name: 'draft' })),
    );

    expect(read).toMatchObject({
      status: 'succeeded',
      output: { groups: [{ type: 'tally', name: 'triage', runs: 1 }] },
    });
    expect(named).toEqual({ status: 'succeeded', output: { groups: [] } });
  });

  it.each(unreadableWindows)('fails the call for a window it cannot read, %j', async (window, defect) => {
    const { dispatcher: d, reported, run } = harness({ runOutcomes: runTallies });

    expect(await run(d.dispatchToPlaybook(readRunTallies.registration, toAlpha(acmeAdmin, window)))).toMatchObject({
      status: 'failed',
    });
    expect(reported().map(({ original }) => String(original))).toEqual([defect]);
  });
});

describe('the read of the names one playbook of the org holds, bound to an org call', () => {
  it('reads the names of a type that playbook holds, and nothing of another playbook, type or org', async () => {
    const { dispatcher: d, ledger, run } = harness();
    await placedIn(ledger.service, 'triage', 'alpha');
    await placedIn(ledger.service, 'brief', 'alpha');
    await placedIn(ledger.service, 'd2', 'beta');
    const namesOf = (asked: typeof NamesAskedSchema.Type, caller = acmeAdmin) =>
      run(d.dispatchToOrg(listNamesHeld.registration, toOrg(caller.org)(caller, asked)));

    expect(
      await Promise.all([
        namesOf({ playbook: 'alpha', type: 'workflow' }),
        namesOf({ playbook: 'beta', type: 'workflow' }),
        namesOf({ playbook: 'alpha', type: 'reasoning' }),
        namesOf({ playbook: 'alpha', type: 'workflow' }, globexAdmin),
      ]),
    ).toEqual([
      { status: 'succeeded', output: { names: ['brief', 'triage'] } },
      { status: 'succeeded', output: { names: ['d2'] } },
      { status: 'succeeded', output: { names: [] } },
      { status: 'succeeded', output: { names: [] } },
    ]);
  });
});

describe('the read of projected rows, bound to a call', () => {
  it('reads only the playbook of the call, and counts its rows', async () => {
    const { dispatcher: d, ledger, run } = harness({ projections: [runTallyRows] });
    const began: RunFact = { type: 'run_began', data: { at: '2026-10-01T09:00:00.000Z', fn: 'triage' } };
    await Effect.runPromise(ledger.service.execute('playbook/acme/alpha/runs/r1', runFacts, [began]));
    await Effect.runPromise(ledger.service.execute('playbook/acme/beta/runs/r2', runFacts, [began]));

    expect(await run(d.dispatchToPlaybook(readTallyRows.registration, toAlpha(acmeAdmin, { limit: 5 })))).toEqual({
      status: 'succeeded',
      output: { runs: ['r1'], open: 1 },
    });
  });

  it('fails the call for a limit below one', async () => {
    const { dispatcher: d, reported, run } = harness({ projections: [runTallyRows] });

    expect(await run(d.dispatchToPlaybook(readTallyRows.registration, toAlpha(acmeAdmin, { limit: 0 })))).toMatchObject(
      { status: 'failed' },
    );
    expect(reported().map(({ original }) => String(original))).toEqual([
      'RangeError: A read of projected rows takes a limit of 1 or more, not 0',
    ]);
  });
});
