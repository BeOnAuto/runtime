import { Cause, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { recorded } from '../reaction-testing/playbook-writes.ts';
import { definitionKeyOfTheTests, definitionOfTheTests, runAt } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { runPlacedIn } from './ledger-run-store.ts';
import { runKeyOf } from './run-address.ts';
import { knownRunOf, playbookOfRun, runKeyOfAnId, runStreamOfAChild, runStreamOfTheKey } from './run-places.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const child = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const runKey = runKeyOf(runAt(runId));

const started = { type: 'run_started', data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {} } };

function opened() {
  return openedOn({ store: 'sqlite', file: aSQLiteFile() });
}

describe('the place of a run the host knows by its key', () => {
  it('is the playbook the run was started in, kept with its row as the host starts it', async () => {
    const database = await opened();
    await Effect.runPromise(runPlacedIn(database, runAt(runId)));
    await Effect.runPromise(runPlacedIn(database, { ...runAt(runId), playbook: 'beta' }));

    expect(await Effect.runPromise(playbookOfRun(database, runKey))).toEqual({ org: 'acme', playbook: 'alpha' });
    expect(await Effect.runPromise(knownRunOf(database, runKey))).toEqual(runAt(runId));
  });

  it('is a fault for a run the host never started, which the host does not know', async () => {
    const database = await opened();

    const fault = Cause.squash(await Effect.runPromise(Effect.flip(Effect.sandbox(playbookOfRun(database, runKey)))));

    expect(fault).toEqual(new Error(`The run ${runKey} was started in no playbook this host knows`));
    expect(await Effect.runPromise(knownRunOf(database, runKey))).toBeUndefined();
  });

  it('files the run and its log under its definition', () => {
    expect([runKey, runStreamOfTheKey(runKey)]).toEqual([
      `acme/${definitionOfTheTests}/${runId}`,
      `${definitionKeyOfTheTests}runs/${runId}`,
    ]);
  });
});

describe('a run the host knows by its id alone', () => {
  it('is found through the reservation of its id in the org, whatever the case of the id', async () => {
    const database = await opened();
    await recorded(database.store, `${definitionKeyOfTheTests}runs/${child}`, started);

    expect(
      await Effect.runPromise(
        Effect.all([
          runKeyOfAnId(database, 'acme', child.toUpperCase()),
          runStreamOfAChild(database, runKey, child),
          runKeyOfAnId(database, 'globex', child),
          runStreamOfAChild(database, runKey, runId),
        ]),
      ),
    ).toEqual([
      `acme/${definitionOfTheTests}/${child.toUpperCase()}`,
      `${definitionKeyOfTheTests}runs/${child}`,
      undefined,
      undefined,
    ]);
  });
});
