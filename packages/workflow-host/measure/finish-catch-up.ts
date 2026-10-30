import { setTimeout } from 'node:timers/promises';

import { recordedReaderOf, statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { hostDatabaseOpenedOn, type DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { alpha, at, playbookCreated, recorded } from '../src/reaction-testing/playbook-writes.ts';
import { measuredHost, runAt } from './measured-host.ts';

export interface FinishCatchUp {
  readonly finishes: number;
  readonly milliseconds: number;
}

type Opened = Awaited<ReturnType<typeof hostDatabaseOpenedOn>>;

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

async function untilPlaced(opened: Opened, reached: (places: readonly (string | null)[]) => boolean): Promise<void> {
  if (!reached(await placesOf(opened))) {
    await setTimeout(2);
    await untilPlaced(opened, reached);
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
  const opened = await hostDatabaseOpenedOn(database);
  await playbookCreated(opened.store, 'alpha');
  const following = await measuredHost(database);
  await untilPlaced(opened, (places) => places.length > 0);
  await following.host.stop();
  await finishedInTurn(opened, finishes);
  const latest = await latestOf(opened);
  const started = performance.now();
  const catchingUp = await measuredHost(database);
  await untilPlaced(opened, ([place]) => place === latest);
  const milliseconds = performance.now() - started;
  await catchingUp.host.stop();
  await opened.close();
  return { finishes, milliseconds };
}
