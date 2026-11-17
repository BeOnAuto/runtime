import { type Statement, statementOf } from '@on.auto/ledger';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { alpha, at, recorded } from '../reaction-testing/playbook-writes.ts';
import { readingMeasured } from '../waiting-testing/measured-reads.ts';
import { resultOfEnding } from '../waiting-testing/recorded-waiting.ts';
import { parentId, parentRun, waitingParent } from '../waiting-testing/waiting-parent.ts';
import { endedChildrenOn } from './child-endings.ts';

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c2';

const ofTheChild = {
  by: 'playbook:alpha',
  at,
  runId: child,
  definitionType: 'computation',
  definitionName: 'check',
  definitionVersion: 1,
  calledBy: { runId: parentId, reference: '/do/0/ask', run: 1 },
};

const started = {
  type: 'run_started',
  data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: { text: 'x'.repeat(100 * 1024) } },
};

const succeeded = { type: 'run_succeeded', data: { output: 'checked', record: {} } };

describe('the ending of a run a run waits for, read before a timer of that run fires', () => {
  it('is read as the last fact of the child alone, and none of the input of 100 KiB its start holds', async () => {
    const measured = readingMeasured((await waitingParent(child)).database);
    await recorded(measured.database.store, `${alpha}runs/${child}`, started, ofTheChild);
    await recorded(measured.database.store, `${alpha}runs/${child}`, succeeded, ofTheChild);
    const readToRecord = measured.bytesRead();
    const submitted: unknown[] = [];
    const endedChildren = endedChildrenOn({
      database: measured.database,
      submitted: (input) =>
        Effect.sync(() => {
          submitted.push(input);
          return { outcome: 'applied', version: 2 };
        }),
      resultOf: resultOfEnding,
      now: () => 1,
      trouble: () => Effect.void,
    });

    await Effect.runPromise(endedChildren(parentRun));

    expect(submitted).toMatchObject([{ kind: 'call_answered', result: { status: 'succeeded', output: 'checked' } }]);
    expect(measured.bytesRead() - readToRecord).toBe(JSON.stringify(succeeded.data).length);
  });
});

const timedChild = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

function explained({ strings, values }: Statement): Statement {
  const [first = '', ...rest] = strings;
  return statementOf([`EXPLAIN QUERY PLAN ${first}`, ...rest], values);
}

function readsRecorded(database: HostDatabase) {
  const asked: Statement[] = [];
  const recording: HostDatabase = {
    ...database,
    read: (statement) =>
      Effect.suspend(() => {
        asked.push(statement);
        return database.read(statement);
      }),
  };
  return { recording, asked: (): readonly Statement[] => asked };
}

describe('the calls of a run, read before a timer of that run fires', () => {
  it('are read through an index of the run’s calls, never by a scan of every call the host keeps', async () => {
    const { database } = await waitingParent(timedChild);
    const { recording, asked } = readsRecorded(database);
    const endedChildren = endedChildrenOn({
      database: recording,
      submitted: () => Effect.die(new Error('Nothing is submitted')),
      resultOf: resultOfEnding,
      now: () => 1,
      trouble: () => Effect.void,
    });

    await Effect.runPromise(endedChildren(parentRun));
    const plans = await Effect.runPromise(Effect.forEach(asked(), (statement) => database.read(explained(statement))));

    expect(asked()).toHaveLength(2);
    expect(JSON.stringify(plans)).toContain('USING INDEX workflow_calls_unclosed_by_run');
    expect(JSON.stringify(plans)).not.toContain('SCAN workflow_calls');
  });
});
