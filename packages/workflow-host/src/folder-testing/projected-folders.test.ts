import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { someFolder } from '../projector/folder.ts';
import { definitionStreamOf } from '../projector/playbook-definitions.ts';
import { onSQLite } from '../testing/host-files.ts';
import { projectedFolders, type ProjectedFolders } from '../testing/index.ts';
import { steppedClock } from '../testing/stepped-clock.ts';
import { alphaKey } from '../views-testing/view-documents.ts';
import { talliesOf, tallyFolderOf, tallyType } from './tally-folder.ts';

const savedAt = '2026-10-06T09:00:00.000Z';

const saved = {
  by: 'acme-admin',
  at: savedAt,
  definitionType: tallyType,
  definitionName: 'runs',
  definitionVersion: 1,
};

const [firstRun, secondRun] = [crypto.randomUUID(), crypto.randomUUID()];

function ranBy(runId: string) {
  return {
    by: 'acme-admin',
    at: savedAt,
    definitionType: 'reasoning',
    definitionName: 'runs',
    definitionVersion: 1,
    runId,
  };
}

const started = {
  type: 'run_started',
  data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, playbook: 'alpha', input: {} },
};

function succeeded(output: number) {
  return { type: 'run_succeeded', data: { output, record: {} } };
}

async function projected() {
  const folders = await projectedFolders(await onSQLite(), [someFolder(tallyFolderOf(1))]);
  onTestFinished(folders.close);
  await folders.append(
    definitionStreamOf(alphaKey, tallyType),
    [
      {
        type: 'definition_created',
        data: {
          content: { source: 'runs', details: { counts: 'run_succeeded' } },
          created_by: { id: 'acme-admin', name: 'acme-admin' },
        },
      },
    ],
    saved,
  );
  return folders;
}

function untilCounted({ database, whenFolded }: ProjectedFolders, counted: number): Promise<unknown> {
  return whenFolded(
    async () => {
      const [row] = await Effect.runPromise(talliesOf(database, alphaKey));
      return row;
    },
    (row) => row?.phase === 'live' && row.counted === counted,
  );
}

describe('the folders a projector keeps, as a test or a measurement opens them', () => {
  it('fold what is appended to a store of their own tables, once a projector is started, until it is stopped', async () => {
    const folders = await projected();
    const read: string[] = [];
    await folders.append(`${alphaKey}runs/${firstRun}`, [started, succeeded(1)], ranBy(firstRun));

    folders.start({
      through: (database) => ({
        ...database,
        read: (statement) => {
          read.push(String(statement.strings[0]));
          return database.read(statement);
        },
      }),
    });
    await untilCounted(folders, 1);
    await folders.append(`${alphaKey}runs/${secondRun}`, [started, succeeded(2)], ranBy(secondRun));
    await untilCounted(folders, 2);
    await folders.stop();

    expect(read.length).toBeGreaterThan(0);
    expect([folders.notes(), folders.troubles()]).toEqual([[], []]);
  });

  it('fold on the clock they are given, waking as each run is appended and sleeping on that clock between', async () => {
    const folders = await projected();
    const clock = steppedClock(Date.parse(savedAt));
    await folders.append(`${alphaKey}runs/${firstRun}`, [started, succeeded(1)], ranBy(firstRun));

    folders.start({ clock, sweepEveryMs: 1000 });
    await untilCounted(folders, 1);
    await clock.asleepAtLeast(1);
    clock.step(1000);
    await clock.asleepAtLeast(1);
    await folders.stop();

    expect([clock.now(), folders.troubles()]).toEqual([Date.parse(savedAt) + 1000, []]);
  });

  it('fold nothing while no projector runs', async () => {
    const folders = await projected();
    folders.start({ sweepEveryMs: 1000, pagesPerWake: 1, playbooksAtOnce: 1 });
    await untilCounted(folders, 0);
    await folders.stop();
    await folders.append(`${alphaKey}runs/${firstRun}`, [started, succeeded(1)], ranBy(firstRun));
    const [row] = await Effect.runPromise(talliesOf(folders.database, alphaKey));

    expect(row?.counted).toBe(0);
  });
});
