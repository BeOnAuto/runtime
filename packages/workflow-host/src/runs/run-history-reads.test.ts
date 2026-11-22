import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerConnectedOn } from '../ledger-testing/ledger-connections.ts';
import { definedOnce } from '../reaction-testing/playbook-writes.ts';
import { definitionKeyOfTheTests, runAt, startOf, workflow } from '../testing/host-documents.ts';
import { openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = runAt(runId);

const waiting = workflow('do:\n  - pause: { wait: PT1H }');

/** A ledger in memory, its connection shared by the host and the test, and the ledger's own reads on that connection. */
async function aLedgerAndItsReads() {
  const opened = await ledgerConnectedOn({ store: 'sqlite', file: ':memory:' });
  onTestFinished(opened.close);
  return opened;
}

describe('the history of a run the host keeps', () => {
  it('keeps the log of a run on the ledger, under its definition, where the history of the run in its playbook reads it', async () => {
    const { connection, ledger } = await aLedgerAndItsReads();
    const hosted = await hostedOn(connection);
    await definedOnce((await openedOn(connection)).store, definitionKeyOfTheTests, 'workflow', 'waiting');
    await Effect.runPromise(hosted.host.start(run, startOf(waiting)));

    const history = await Effect.runPromise(
      ledger.readRecorded({ org: 'acme', playbook: 'alpha' }, { kind: 'run', run: runId }, { order: 'asc', limit: 10 }),
    );

    expect(history.records.map(({ stream, type }) => [stream, type])).toEqual([
      [`${definitionKeyOfTheTests}run-logs/${runId}`, 'input_applied'],
    ]);
  });
});
