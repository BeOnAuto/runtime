import { messageIdOf } from '@on.auto/operations';

import type { HostDatabase } from '../database/host-database.ts';
import { at, recorded } from '../reaction-testing/playbook-writes.ts';
import { runKeyOf } from '../runs/run-address.ts';
import { definitionKeyOfTheTests, runAt, startOf, workflow } from '../testing/host-documents.ts';
import { startedIn } from '../testing/started-runs.ts';

export const lostRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const lostRunKey = runKeyOf(runAt(lostRunId));

export const lostStream = `${definitionKeyOfTheTests}runs/${lostRunId}`;

export function filedRunOf(runId: string): { readonly runKey: string; readonly stream: string } {
  return { runKey: runKeyOf(runAt(runId)), stream: `${definitionKeyOfTheTests}runs/${runId}` };
}

export function lostRunPlaced(database: HostDatabase): Promise<HostDatabase> {
  return startedIn(database, lostRunId);
}

export const lostCancelId = messageIdOf(lostStream, 2);

export const lostStart = startOf(workflow('do:\n  - pause: { wait: PT1H }'));

export const askedCancel = { by: 'acme-admin', kind: 'requested', reason: 'Not needed any more' } as const;

const ofTheRun = {
  by: askedCancel.by,
  at,
  runId: lostRunId,
  definitionType: 'workflow',
  definitionName: 'pause',
  definitionVersion: 1,
};

export async function startedThenCancelled(database: HostDatabase): Promise<void> {
  await recorded(
    database.store,
    lostStream,
    {
      type: 'run_started',
      data: {
        started_by: { id: 'acme-admin', name: 'acme-admin' },
        playbook: 'alpha',
        input: {},
        finishes_later: true,
      },
    },
    ofTheRun,
  );
  await recorded(
    database.store,
    lostStream,
    { type: 'run_cancel_requested', data: { kind: askedCancel.kind, reason: askedCancel.reason } },
    ofTheRun,
  );
}
