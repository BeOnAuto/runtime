import { statementOf, type Statement } from '@on.auto/ledger';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { resultOfEnding } from '../waiting-testing/recorded-waiting.ts';
import { parentRun, waitingParent } from '../waiting-testing/waiting-parent.ts';
import { endedChildrenOn } from './child-endings.ts';

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

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
    const { database } = await waitingParent(child);
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
