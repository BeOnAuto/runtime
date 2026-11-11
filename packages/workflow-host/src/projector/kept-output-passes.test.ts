import { keptArmOf, keptIn } from '@on.auto/definitions/testing';
import { Unavailable } from '@on.auto/operations';
import { payloadReaderOf } from '@on.auto/operations/payloads';
import { Effect, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { talliesOf, tallyFolderOf, tallyType } from '../folder-testing/tally-folder.ts';
import { projectorWakeUp, someFolder } from '../index.ts';
import { onSQLite } from '../testing/host-files.ts';
import { projectedFolders, type ProjectedFolders } from '../testing/index.ts';
import { recordingReports } from '../testing/recording-reports.ts';

const alpha = 'playbook/acme/alpha/';

const owner = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const savedAt = '2026-10-06T09:00:00.000Z';

const output = { report: 'r'.repeat(40_000) };

async function talliedSuccess(store: ProjectedFolders, keeps: boolean): Promise<void> {
  const { sha256, bytes } = keeps
    ? await Effect.runPromise(keptIn(store.database.content, owner, output))
    : keptArmOf(output);
  await store.append(
    `${alpha}definitions/${tallyType}`,
    [
      {
        type: 'definition_created',
        data: {
          content: { source: 'runs', details: { counts: 'run_succeeded' } },
          created_by: { id: 'acme-admin', name: 'acme-admin' },
        },
      },
    ],
    { by: 'acme-admin', at: savedAt, definitionType: tallyType, definitionName: 'runs', definitionVersion: 1 },
  );
  await store.append(
    `${alpha}runs/${runId}`,
    [
      { type: 'run_started', data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {} } },
      { type: 'run_succeeded', data: { output_sha256: sha256, output_bytes: bytes, record: {} } },
    ],
    { by: 'acme-admin', at: savedAt, definitionType: 'reasoning', definitionName: 'runs', definitionVersion: 1, runId },
  );
}

async function keptAndTallied(keeps: boolean) {
  const folders = [someFolder(tallyFolderOf(1))];
  const store = await projectedFolders(await onSQLite(), folders);
  onTestFinished(store.close);
  await talliedSuccess(store, keeps);
  const down = { now: true };
  const reader = payloadReaderOf({ owner, content: store.database.content });
  const reports = recordingReports();
  const projector = projectorWakeUp(
    {
      database: store.database,
      factPayloadsOf: () => ({
        ...reader,
        json: (digested) =>
          down.now
            ? Effect.fail(new Unavailable({ detail: 'The content store did not answer' }))
            : reader.json(digested),
      }),
      settings: { folders, playbooksAtOnce: 4, pagesPerWake: 10 },
      reports: reports.reports,
    },
    { raised: Function.constVoid, renewed: Function.constVoid },
  );
  onTestFinished(() => Effect.runPromise(projector.stop()));
  return {
    wakeUp: () => Effect.runPromise(projector.wakeUp({ now: Date.now(), sweep: true })),
    tallied: async () => (await Effect.runPromise(talliesOf(store.database, alpha))).map(({ counted }) => counted),
    up: () => {
      down.now = false;
    },
    troubles: reports.troubles,
    notes: reports.notes,
  };
}

describe('a pass of the views over a fact whose kept output the content store cannot give just now', () => {
  it('ends with nothing folded and no trouble, and folds the fact once the store answers', async () => {
    const projected = await keptAndTallied(true);

    await projected.wakeUp();
    const whileDown = await projected.tallied();
    projected.up();
    await projected.wakeUp();
    await projected.wakeUp();

    expect([whileDown, await projected.tallied(), projected.troubles()]).toEqual([[0], [1], []]);
  });
});

describe('a pass of the views over a fact whose kept output is missing from its playbook’s content', () => {
  it('folds the fact with the output as its size and says the output is missing', async () => {
    const projected = await keptAndTallied(false);
    projected.up();

    await projected.wakeUp();
    await projected.wakeUp();

    expect(await projected.tallied()).toEqual([1]);
    const missing = projected.notes().filter(({ kind }) => kind === 'record_content_missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ org: 'acme', playbook: 'alpha', type: 'run_succeeded', passedBy: 'views' });
  });
});
