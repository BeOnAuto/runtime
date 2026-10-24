import { Effect, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { talliesOf, tallyFolderOf, tallyType } from '../folder-testing/tally-folder.ts';
import { projectorWakeUp, someFolder, type HostDatabase, type NextWake } from '../index.ts';
import { onSQLite } from '../testing/host-files.ts';
import { projectedFolders, type ProjectedFolders } from '../testing/index.ts';
import { recordingReports } from '../testing/recording-reports.ts';
import { until } from '../testing/until.ts';

const alpha = 'playbook/acme/alpha/';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const savedAt = '2026-10-06T09:00:00.000Z';

interface WokenProjector {
  readonly store: ProjectedFolders;
  readonly wakeUp: (sweep: boolean) => Promise<NextWake>;
  readonly discoveries: () => number;
  readonly troubles: () => readonly string[];
}

async function wokenProjector(): Promise<WokenProjector> {
  const folders = [someFolder(tallyFolderOf(1))];
  const store = await projectedFolders(await onSQLite(), folders);
  onTestFinished(store.close);
  const reports = recordingReports();
  const counted = { discoveries: 0 };
  const database: HostDatabase = {
    ...store.database,
    store: {
      ...store.database.store,
      definitionStreams: (definitionType) => {
        counted.discoveries += 1;
        return store.database.store.definitionStreams(definitionType);
      },
    },
  };
  const projector = projectorWakeUp(
    { database, settings: { folders, playbooksAtOnce: 4, pagesPerWake: 10 }, reports: reports.reports },
    { raised: Function.constVoid, renewed: Function.constVoid },
  );
  onTestFinished(() => Effect.runPromise(projector.stop()));
  return {
    store,
    wakeUp: (sweep) => Effect.runPromise(projector.wakeUp({ now: Date.now(), sweep })),
    discoveries: () => counted.discoveries,
    troubles: reports.troubles,
  };
}

async function talliedRunOf({ append }: ProjectedFolders): Promise<void> {
  await append(
    `${alpha}definitions/${tallyType}`,
    [{ type: 'definition_created', data: { content: { source: 'runs', details: { counts: 'run_succeeded' } } } }],
    { by: 'acme-admin', at: savedAt, definitionType: tallyType, definitionName: 'runs', definitionVersion: 1 },
  );
  await append(
    `${alpha}runs/${runId}`,
    [
      { type: 'run_started', data: { input: {} } },
      { type: 'run_succeeded', data: { output: 1, record: {} } },
    ],
    { by: 'acme-admin', at: savedAt, definitionType: 'reasoning', definitionName: 'runs', definitionVersion: 1, runId },
  );
}

function liveAfterWaking({ wakeUp, store }: WokenProjector): Promise<unknown> {
  return until(async () => {
    await wakeUp(false);
    const [row] = await Effect.runPromise(talliesOf(store.database, alpha));
    expect([row?.phase, row?.counted]).toEqual(['live', 1]);
  });
}

describe('the projector of a host composed by a clock of its own', () => {
  it('folds the history of a playbook into the rows of its folders when it is woken, and answers no next wake once it is idle', async () => {
    const projector = await wokenProjector();
    await talliedRunOf(projector.store);

    await projector.wakeUp(true);
    await liveAfterWaking(projector);
    const idle = await projector.wakeUp(false);

    expect([idle, projector.troubles()]).toEqual([{ nextDueAt: null }, []]);
  });

  it('runs one wake at a time: a wake that comes while one runs waits for it and answers what it answers', async () => {
    const projector = await wokenProjector();
    await talliedRunOf(projector.store);

    const together = await Promise.all([projector.wakeUp(true), projector.wakeUp(true)]);
    const discoveredTogether = projector.discoveries();
    await projector.wakeUp(true);

    expect([together[0], discoveredTogether, projector.discoveries()]).toEqual([together[1], 1, 2]);
  });
});
