import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { Ledger } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { definedOnce } from '../reaction-testing/playbook-writes.ts';
import { definitionKeyOfTheTests, runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = runAt(runId);

const waiting = workflow('do:\n  - pause: { wait: PT1H }');

function ledgerOn(fileName: string): Promise<Ledger['Service']> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Ledger);
}

describe('the history of a run the host keeps', () => {
  it('keeps the log of a run on the ledger, under its definition, where the history of the run in its playbook reads it', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await definedOnce(
      (await openedOn({ store: 'sqlite', file })).store,
      definitionKeyOfTheTests,
      'workflow',
      'waiting',
    );
    await Effect.runPromise(hosted.host.start(run, startOf(waiting)));
    const ledger = await ledgerOn(file);

    const history = await Effect.runPromise(
      ledger.readRecorded({ org: 'acme', playbook: 'alpha' }, { kind: 'run', run: runId }, { order: 'asc', limit: 10 }),
    );

    expect(history.records.map(({ stream, type }) => [stream, type])).toEqual([
      [`${definitionKeyOfTheTests}run-logs/${runId}`, 'input_applied'],
    ]);
  });
});
