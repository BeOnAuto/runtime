import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf } from '../database/host-database.ts';
import {
  alpha,
  definitionRecorded,
  emittedContext,
  eventTrigger,
  published,
  recorded,
  runRecorded,
} from '../reaction-testing/playbook-writes.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../testing/until.ts';

const succeeded = { type: 'run_succeeded' };

const told = { type: 'com.acme.told' };

const RefusalRow = Schema.Struct({ workflow: Schema.String, reason: Schema.String });

async function startsOnceTheSentinelPassed(reacting: ReactingHost) {
  const sentinel = eventTrigger({ type: 'com.acme.sentinel' });
  await definitionRecorded(reacting.database.store, { name: 'watch', version: 1, triggers: [sentinel] });
  await published(reacting.database.store, { id: 'sentinel', type: 'com.acme.sentinel' });
  return until(
    () => Promise.resolve(reacting.reactions.starts()),
    (starts) => starts.some(({ workflow }) => workflow === 'watch'),
  );
}

describe('a workflow that reacts to the facts of the playbook', () => {
  it('starts on the success of another run, with the fact as its input and one more reaction depth', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'follow', version: 1, triggers: [eventTrigger(succeeded)] });

    await runRecorded(store, { runId: 'r-sum', type: 'reasoning', name: 'sum', depth: 2 }, 'run_succeeded');
    const starts = await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (found) => found.length > 0,
    );

    expect(starts).toMatchObject([
      {
        workflow: 'follow',
        depth: 3,
        input: [
          {
            type: 'run_succeeded',
            source: '/runs/r-sum',
            subject: 'reasoning/sum',
            depth: 2,
            data: { output: 'done' },
          },
        ],
      },
    ]);
  });
});

describe('a workflow and its own runs', () => {
  it('never reacts to facts about its runs, nor about runs one of its runs started, nor to events its runs emitted', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'follow', version: 1, triggers: [eventTrigger(succeeded, told)] });

    await runRecorded(store, { runId: 'r-own', type: 'workflow', name: 'follow' }, 'run_succeeded');
    await runRecorded(store, { runId: 'r-top', type: 'workflow', name: 'follow' });
    const nested = { runId: 'r-nested', type: 'reasoning', name: 'sum', correlation: 'r-top' };
    await runRecorded(store, nested, 'run_succeeded');
    await published(store, { id: 'told', type: 'com.acme.told' }, emittedContext('r-top', 'follow', 1));
    const starts = await startsOnceTheSentinelPassed(reacting);

    expect(starts.map(({ workflow }) => workflow)).toEqual(['watch']);
  });
});

describe('a chain of reactions', () => {
  it('stops at a reaction depth of 8: a match past it starts nothing and is refused', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    await definitionRecorded(store, { name: 'deep', version: 1, triggers: [eventTrigger(told)] });

    await published(store, { id: 'eighth', type: 'com.acme.told' }, emittedContext('r1', 'other', 8));
    await published(store, { id: 'ninth', type: 'com.acme.told' }, emittedContext('r2', 'other', 9));
    const starts = await startsOnceTheSentinelPassed(reacting);
    const refusals = await Effect.runPromise(
      rowsOf(RefusalRow, reacting.database.read(statement`SELECT workflow, reason FROM workflow_reaction_refusals`)),
    );

    expect(starts.map(({ workflow, depth }) => [workflow, depth])).toEqual([
      ['deep', 8],
      ['watch', 1],
    ]);
    expect(refusals).toEqual([
      {
        workflow: 'deep',
        reason:
          'An event matched the event trigger of the workflow at reaction depth 9, past the 8 a chain of reactions may reach',
      },
    ]);
  });
});

describe('a playbook whose run log holds a record its dispatch never covers', () => {
  it('passes the record at the twentieth sweep, says so, and goes on to the events after it', async () => {
    const reacting = await reactingHost({ sweepEveryMs: 10 });
    const { store } = reacting.database;
    await definitionRecorded(store, {
      name: 'close',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.closed' })],
    });
    await recorded(store, `${alpha}run-logs/r-stuck`, { type: 'input_applied', data: { input: {} } });
    await published(store, { id: 'closed', type: 'com.acme.closed' });

    const starts = await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (found) => found.length > 0,
    );

    expect(starts.map(({ workflow }) => workflow)).toEqual(['close']);
    expect(reacting.notes()).toMatchObject([
      {
        kind: 'run_record_passed',
        run: { org: 'acme', playbook: 'alpha', runId: 'r-stuck' },
        version: 1,
        sweeps: 20,
      },
    ]);
  });
});
