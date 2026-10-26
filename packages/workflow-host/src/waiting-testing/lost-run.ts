import { messageIdOf } from '@on.auto/operations';

import type { HostDatabase } from '../database/host-database.ts';
import { alpha, at, recorded } from '../reaction-testing/playbook-writes.ts';
import { startOf, workflow } from '../testing/host-documents.ts';

export const lostRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const lostRunKey = `acme/alpha/${lostRunId}`;

export const lostStream = `${alpha}runs/${lostRunId}`;

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
      data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {}, finishes_later: true },
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
