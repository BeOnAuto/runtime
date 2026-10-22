import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { someFolder } from '../projector/folder.ts';
import { definitionStreamOf } from '../projector/playbook-definitions.ts';
import { onSQLite } from '../testing/host-files.ts';
import { projectedFolders, type ProjectedFolders } from '../testing/index.ts';
import { until } from '../testing/until.ts';
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
        },
      },
    ],
    saved,
  );
  return folders;
}

function untilCounted({ database }: ProjectedFolders, counted: number): Promise<unknown> {
  return until(async () => {
    const [row] = await Effect.runPromise(talliesOf(database, alphaKey));
    expect([row?.phase, row?.counted]).toEqual(['live', counted]);
  });
}

describe('the folders a projector keeps, as a test or a measurement opens them', () => {
  it('fold what is appended to a store of their own tables, once a projector is started, until it is stopped', async () => {
    const folders = await projected();
    const read: string[] = [];
    await folders.append(
      `${alphaKey}runs/${firstRun}`,
      [{ type: 'run_started', data: { input: {} } }, succeeded(1)],
      ranBy(firstRun),
    );

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
    await folders.append(
      `${alphaKey}runs/${secondRun}`,
      [{ type: 'run_started', data: { input: {} } }, succeeded(2)],
      ranBy(secondRun),
    );
    await untilCounted(folders, 2);
    await folders.stop();

    expect(read.length).toBeGreaterThan(0);
    expect([folders.notes(), folders.troubles()]).toEqual([[], []]);
  });

  it('fold nothing while no projector runs', async () => {
    const folders = await projected();
    folders.start({ sweepEveryMs: 1000, pagesPerWake: 1, playbooksAtOnce: 1 });
    await untilCounted(folders, 0);
    await folders.stop();
    await folders.append(
      `${alphaKey}runs/${firstRun}`,
      [{ type: 'run_started', data: { input: {} } }, succeeded(1)],
      ranBy(firstRun),
    );
    const [row] = await Effect.runPromise(talliesOf(folders.database, alphaKey));

    expect(row?.counted).toBe(0);
  });
});
