import { setTimeout } from 'node:timers/promises';

import { recordedReaderOf } from '@on.auto/ledger';
import { Effect, Function, Schema } from 'effect';

import { openHostDatabase, type DatabaseSettings } from '../src/database/host-databases.ts';
import { statement } from '../src/database/statement.ts';
import { alpha, at, playbookCreated, recorded } from '../src/reaction-testing/playbook-writes.ts';
import { measuredHost, runAt } from './measured-host.ts';

export interface FinishCatchUp {
  readonly finishes: number;
  readonly milliseconds: number;
}

type Opened = Awaited<ReturnType<typeof openHostDatabase>>;

const Places = Schema.Array(Schema.Struct({ cursor: Schema.NullOr(Schema.String) }));

function finishOf(index: number) {
  return { type: 'run_succeeded', data: { output: { index }, record: {} } };
}

const ofTheRun = { by: 'acme-admin', at, definitionType: 'workflow', definitionName: 'measured', definitionVersion: 1 };

async function placesOf(opened: Opened): Promise<readonly (string | null)[]> {
  const rows = await Effect.runPromise(
    opened.read(statement`SELECT cursor FROM workflow_followed_playbooks WHERE playbook_key = ${alpha}`),
  );
  return Schema.decodeUnknownSync(Places)(rows).map(({ cursor }) => cursor);
}

async function latestOf(opened: Opened): Promise<string | null> {
  const { records } = await Effect.runPromise(
    recordedReaderOf(opened.store)(
      { org: 'acme', playbook: 'alpha' },
      { kind: 'everything' },
      {
        order: 'desc',
        limit: 1,
        dataOf: [],
      },
    ),
  );
  return records[0]?.cursor ?? null;
}

async function untilAt(opened: Opened, cursor: string | null): Promise<void> {
  const [place] = await placesOf(opened);
  if (place !== cursor) {
    await setTimeout(2);
    await untilAt(opened, cursor);
  }
}

async function finishedInTurn(opened: Opened, count: number, index = 0): Promise<void> {
  if (index < count) {
    const { runId } = runAt(index);
    await recorded(opened.store, `${alpha}runs/${runId}`, finishOf(index), { ...ofTheRun, runId });
    await finishedInTurn(opened, count, index + 1);
  }
}

export async function finishCatchUpOn(database: DatabaseSettings, finishes: number): Promise<FinishCatchUp> {
  const opened = await openHostDatabase(database, Function.constVoid);
  await playbookCreated(opened.store, 'alpha');
  const following = await measuredHost(database);
  await untilAt(opened, await latestOf(opened));
  await following.host.stop();
  await finishedInTurn(opened, finishes);
  const latest = await latestOf(opened);
  const started = performance.now();
  const catchingUp = await measuredHost(database);
  await untilAt(opened, latest);
  const milliseconds = performance.now() - started;
  await catchingUp.host.stop();
  await opened.close();
  return { finishes, milliseconds };
}
