import { makeAppRuntime } from '@on.auto/api';
import { recordedAsGiven } from '@on.auto/definitions/testing';
import { LedgerConnection } from '@on.auto/ledger';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { Ledger } from '@on.auto/operations';
import { openWorkflowStore } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import { applicationLayer } from '../../composition/application-layer.ts';
import { inRuntime } from '../../workflows/in-runtime.ts';

interface Recorded {
  readonly stream: string;
  readonly events: Parameters<typeof recordedAsGiven>[2];
  readonly context: Parameters<typeof recordedAsGiven>[3];
}

export async function runtimeRecording({ stream, events, context }: Recorded) {
  const runtime = await makeAppRuntime(applicationLayer(ledgerLayer({ fileName: ':memory:' })));
  onTestFinished(() => runtime.dispose());
  const connection = await Effect.runPromise(inRuntime(runtime, Effect.service(LedgerConnection)));
  const recorded = Effect.flatMap(Effect.service(Ledger), (ledger) => recordedAsGiven(ledger, stream, events, context));
  await Effect.runPromise(inRuntime(runtime, recorded));
  return { runtime, store: await openWorkflowStore(connection, []) };
}
