import type { Lineage } from '@on.auto/operations';
import { Effect } from 'effect';

import { runCanceller, type Capability } from '../index.ts';
import type { ReadModelStage } from '../read-model-staging/read-model-stage.ts';
import { comparedMessage } from '../read-model-staging/shadow-comparison.ts';
import type { RunCommand } from '../runs/run-commands.ts';
import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook, type Harness } from '../testing/harness.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-0000000000e1';

const address = { org: 'acme', playbook: 'alpha', id: runId };

const stream = `playbook/acme/alpha/runs/${runId}`;

const lineage: Lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: runId };

export const longestCallMs = 70_000;

const acted = { runId, by: 'acme-admin', at: firstMoment };

function startedAt(version: number): readonly RunCommand[] {
  return [
    {
      type: 'start',
      definition_type: 'system-call',
      name: 'post',
      input: {},
      started_by: { id: acmeAdmin.id, name: acmeAdmin.name },
      definition_version: version,
      calls_tools: true,
      ...acted,
    },
    {
      type: 'call',
      fact: {
        type: 'tool_call_started',
        data: { call_id: 'toolu_1', server: 'slack', tool: 'post_message', arguments_bytes: 2 },
      },
      ...acted,
    },
  ];
}

async function cancelledAfterItDied(definitions: Harness, systemCall: Capability, version: number) {
  const operations = definitionOperationsFor([systemCall]);
  await definitions.call(
    operations.createDefinition,
    toPlaybook('acme', 'alpha')(acmeAdmin, { type: 'system-call', name: 'post', source: 'post' }),
  );
  const { service } = definitions.ledger;
  await definitions.run(
    Effect.orDie(Effect.forEach(startedAt(version), (command) => service.execute(stream, runDecider, command))),
  );
  const later = new Date(Date.parse(firstMoment) + longestCallMs + 1000).toISOString();
  const cancel = runCanceller(service, [systemCall], () => Effect.void);
  const reason = 'The step that waited for this run ran out of time, so it no longer needs it';
  await definitions.run(Effect.orDie(cancel(address, { kind: 'deadline', reason }, lineage)), later);
  const read = await definitions.call(operations.getRun, toPlaybook('acme', 'alpha')(acmeAdmin, { run_id: runId }));
  const compared = definitions
    .logged()
    .filter(({ message, annotations }) => message === comparedMessage && annotations['read'] === 'longest_run')
    .map(({ annotations }) => annotations['outcome']);
  return { read, compared };
}

function staged(stage?: ReadModelStage): Harness {
  return stage === undefined ? harness() : harness(undefined, undefined, { stage, folds: ['system-call'] });
}

interface CancelsStaged {
  readonly reads: readonly unknown[];
  readonly compared: readonly unknown[];
}

export async function cancelsAt(systemCall: Capability, stage?: ReadModelStage): Promise<CancelsStaged> {
  const first = await cancelledAfterItDied(staged(stage), systemCall, 1);
  const second = await cancelledAfterItDied(staged(stage), systemCall, 2);
  return { reads: [first.read, second.read], compared: [first.compared, second.compared] };
}
