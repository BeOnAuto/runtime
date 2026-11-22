import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { someFolder } from '../projector/folder.ts';
import { definitionStreamOf } from '../projector/playbook-definitions.ts';
import { onSQLite } from '../testing/host-files.ts';
import { projectedFolders, type ProjectedFolders, type ProjectingOptions } from '../testing/index.ts';
import { fewSweeps, steppedBy, steppedClock, type SteppedClock } from '../testing/stepped-clock.ts';
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

const sweepMs = 1000;

/** The folders started on a stepped clock of their own, the clock returned for the test to step. */
function startedOnAClock(folders: ProjectedFolders, options: ProjectingOptions = {}): SteppedClock {
  const clock = steppedClock(Date.parse(savedAt));
  folders.start({ ...options, clock, context: clock.watching(), sweepEveryMs: sweepMs });
  return clock;
}

function untilCounted({ database }: ProjectedFolders, clock: SteppedClock, counted: number): Promise<unknown> {
  return steppedBy(clock, sweepMs).until(
    async () => {
      const [row] = await Effect.runPromise(talliesOf(database, alphaKey));
      return row;
    },
    (row) => row?.phase === 'live' && row.counted === counted,
    fewSweeps,
  );
}

function readsTo(seen: (statement: string) => void): NonNullable<ProjectingOptions['through']> {
  return (database) => ({
    ...database,
    read: (statement) => {
      seen(String(statement.strings[0]));
      return database.read(statement);
    },
  });
}

describe('the folders a projector keeps, as a test or a measurement opens them', () => {
  it('fold what is appended to a store of their own tables, once a projector is started, until it is stopped', async () => {
    const folders = await projected();
    const read: string[] = [];
    await folders.append(`${alphaKey}runs/${firstRun}`, [started, succeeded(1)], ranBy(firstRun));

    const clock = startedOnAClock(folders, {
      through: readsTo((statement) => {
        read.push(statement);
      }),
    });
    await untilCounted(folders, clock, 1);
    await folders.append(`${alphaKey}runs/${secondRun}`, [started, succeeded(2)], ranBy(secondRun));
    await untilCounted(folders, clock, 2);
    await folders.stop();

    expect(read.length).toBeGreaterThan(0);
    expect([folders.notes(), folders.troubles()]).toEqual([[], []]);
  });

  it('fold on the clock they are given, waking as each run is appended and sleeping on that clock between', async () => {
    const folders = await projected();
    await folders.append(`${alphaKey}runs/${firstRun}`, [started, succeeded(1)], ranBy(firstRun));

    const clock = startedOnAClock(folders);
    await untilCounted(folders, clock, 1);
    const foldedAt = clock.now();
    clock.step(sweepMs);
    await clock.atRest();
    await folders.stop();

    expect([foldedAt, clock.now(), folders.troubles()]).toEqual([
      Date.parse(savedAt),
      Date.parse(savedAt) + sweepMs,
      [],
    ]);
  });

  it('fold nothing while no projector runs', async () => {
    const folders = await projected();
    const clock = startedOnAClock(folders, { pagesPerWake: 2, playbooksAtOnce: 1 });
    await untilCounted(folders, clock, 0);
    await folders.stop();
    await folders.append(`${alphaKey}runs/${firstRun}`, [started, succeeded(1)], ranBy(firstRun));
    const [row] = await Effect.runPromise(talliesOf(folders.database, alphaKey));

    expect(row?.counted).toBe(0);
  });
});
