import type { HeldName } from '@on.auto/operations/definition-names';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { tallyFolderOf, tallyOf, tallyType, type TallyDetails } from '../folder-testing/tally-folder.ts';
import { tallyHarness, type TallyHarness } from '../folder-testing/tally-harness.ts';
import { onSQLite } from '../testing/host-files.ts';
import { alphaKey } from '../views-testing/view-documents.ts';
import { definitionStreamOf } from './playbook-definitions.ts';
import { definitionsByType } from './projector-schedule.ts';
import { reconciledRows } from './reconciled-rows.ts';

const started: TallyDetails = { counts: 'run_started' };

const succeeded: TallyDetails = { counts: 'run_succeeded' };

const failed: TallyDetails = { counts: 'run_failed' };

const first = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b71/';

const second = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b72/';

const unheld = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b73/';

function heldBy(definitionKey: string, name: string): HeldName {
  return {
    playbookKey: alphaKey,
    definitionType: tallyType,
    name,
    definitionKey,
    status: 'active',
    hasTriggers: false,
  };
}

const held = [heldBy(first, 'started'), heldBy(second, 'succeeded')];

function contextOf(name: string, at: string) {
  return { by: 'acme-admin', at, definitionType: tallyType, definitionName: name, definitionVersion: 1 };
}

async function savedUnder(tallies: TallyHarness, definitionKey: string, details: TallyDetails, at: string) {
  const content = { source: `the ${details.counts} tally`, details };
  await tallies.append(
    definitionStreamOf(definitionKey, tallyType),
    [{ type: 'definition_created', data: { content, created_by: { id: 'acme-admin', name: 'acme-admin' } } }],
    contextOf(details.counts, at),
  );
}

function holding({ store: { database } }: TallyHarness): TallyHarness['store']['database'] {
  return {
    ...database,
    store: {
      ...database.store,
      namesHeldIn: ({ playbookKey, definitionType }) =>
        Promise.resolve(
          held.filter((name) => name.playbookKey === playbookKey && name.definitionType === definitionType),
        ),
    },
  };
}

async function heldTallies() {
  const tallies = await tallyHarness(await onSQLite());
  await savedUnder(tallies, first, started, '2026-10-06T09:00:01.000Z');
  await savedUnder(tallies, second, succeeded, '2026-10-06T09:00:02.000Z');
  await savedUnder(tallies, unheld, failed, '2026-10-06T09:00:03.000Z');
  const kept = { database: holding(tallies), definitions: definitionsByType() };
  return { tallies, kept, reconciled: () => Effect.runPromise(reconciledRows(tallyFolderOf(4), kept, alphaKey)) };
}

describe('the definitions of a playbook, each filed on a stream of its own', () => {
  it('are folded from each stream whose definition holds a name in the playbook and from no other, each key remembered with its playbook', async () => {
    const { kept, reconciled } = await heldTallies();

    const rows = await reconciled();

    expect(rows.map(({ tally }) => tally).toSorted()).toEqual([tallyOf(started), tallyOf(succeeded)].toSorted());
    expect([first, second, unheld, alphaKey].map((key) => kept.definitions.playbookOf(key))).toEqual([
      alphaKey,
      alphaKey,
      undefined,
      alphaKey,
    ]);
  });

  it('drop the row of one retired on its own stream, leaving the other’s as it was', async () => {
    const { tallies, reconciled } = await heldTallies();
    const before = (await reconciled()).find(({ tally }) => tally === tallyOf(started));
    await tallies.append(
      definitionStreamOf(second, tallyType),
      [{ type: 'definition_retired', data: {} }],
      contextOf(succeeded.counts, '2026-10-06T09:00:04.000Z'),
    );

    const rows = await reconciled();

    expect(rows.map(({ tally }) => tally)).toEqual([tallyOf(started)]);
    expect(rows[0]?.saved).toBe(before?.saved);
  });
});
