import { makeAppRuntime } from '@on.auto/api';
import { definedWithItsId, definitionNamesWith, recordedAsGiven } from '@on.auto/definitions/testing';
import { LedgerConnection } from '@on.auto/ledger';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { Ledger, streamPrefixOfDefinition, streamPrefixOfPlaybook } from '@on.auto/operations';
import { openWorkflowStore } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import { applicationLayer } from '../../composition/application-layer.ts';
import { inRuntime } from '../../workflows/in-runtime.ts';

type RunEvents = Parameters<typeof recordedAsGiven>[2];

type RunContext = Parameters<typeof recordedAsGiven>[3];

interface RunsDefinition {
  readonly type: string;
  readonly name: string;
}

interface Recorded {
  readonly definition: RunsDefinition;
  readonly events: RunEvents;
  readonly context: RunContext;
}

const alpha = { org: 'acme', playbook: 'alpha' };

export function recordedUnderItsDefinition(
  ledger: Ledger['Service'],
  { type, name }: RunsDefinition,
  events: RunEvents,
  context: RunContext,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const named = { playbookKey: streamPrefixOfPlaybook(alpha), definitionType: type, name };
    const placed = (yield* ledger.holderOfName(named))?.definitionKey;
    const id = `${type}-${name}`;
    if (placed === undefined) {
      yield* definedWithItsId(ledger, alpha, { type, name, source: '{}', id });
    }
    const key = placed ?? streamPrefixOfDefinition({ org: alpha.org, definition: id });
    yield* recordedAsGiven(ledger, `${key}runs/${context.runId}`, events, context);
  });
}

export async function runtimeRecording({ definition, events, context }: Recorded) {
  const runtime = await makeAppRuntime(
    applicationLayer(ledgerLayer({ fileName: ':memory:', definitionNames: definitionNamesWith([]) })),
  );
  onTestFinished(() => runtime.dispose());
  const connection = await Effect.runPromise(inRuntime(runtime, Effect.service(LedgerConnection)));
  const recorded = Effect.flatMap(Effect.service(Ledger), (ledger) =>
    recordedUnderItsDefinition(ledger, definition, events, context),
  );
  await Effect.runPromise(inRuntime(runtime, recorded));
  return { runtime, store: await openWorkflowStore(connection, []) };
}
