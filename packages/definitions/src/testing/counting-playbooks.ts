import { Effect, Schema } from 'effect';

import { defineCapability, type Capability } from '../capability/capability.ts';
import { savedPage, savePlaybook } from '../exporting/playbook-saving.ts';
import { textOf } from '../goals/goal-examples.ts';
import type { Goal } from '../goals/goals-document.ts';
import { acmeAdmin } from './callers.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { harness, toPlaybook, type Harness } from './harness.ts';

export const toAlpha = toPlaybook('acme', 'alpha');

export const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const decodedWorkflow = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ contributes: Schema.optionalKey(Schema.Json) })),
);

export const contributing: Capability = defineCapability({
  type: 'workflow',
  title: 'Workflow',
  guide: { name: 'workflow' },
  noun: { one: 'workflow', other: 'workflows' },
  describeOutput: () => 'It ran.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodedWorkflow(source)),
  summarize: ({ contributes }) => (contributes === undefined ? {} : { details: { contributes } }),
  run: () => Effect.succeed({ output: {}, record: {} }),
});

export const kept = definitionOperationsFor([contributing], undefined, undefined, { goals: true, messages: true });

const notKept = definitionOperationsFor([contributing]);

export const success = {
  label: 'Done',
  settles: 'on_crossing',
  target: { at_least: 1 },
  passed: 'Done',
  failed: 'Not done',
} satisfies Goal['success'];

export const requests = {
  id: 'change-requests',
  name: 'Change requests',
  statement: 'Every request is revised.',
  success,
} satisfies Goal;

export const replies = { id: 'replies', statement: 'Every request gets a reply.', success } satisfies Goal;

export const toward = (goal: string) => ({ goal, purpose: 'Does the work.' });

export function goalsSaved(definitions: Harness, goals: readonly object[]) {
  return definitions.call(savePlaybook, toAlpha(acmeAdmin, { page: savedPage, goals: textOf(goals) }));
}

export async function playbookWith(contributes?: readonly object[]): Promise<Harness> {
  const definitions = harness();
  await goalsSaved(definitions, [requests, replies]);
  await definitions.call(
    (contributes === undefined ? notKept : kept).createDefinition,
    toAlpha(acmeAdmin, { type: 'workflow', name: 'revise', source: JSON.stringify({ contributes }) }),
  );
  return definitions;
}

export async function contextsOf(definitions: Harness) {
  const { records } = await definitions.run(
    Effect.orDie(
      definitions.ledger.service.readRecorded(
        { org: 'acme', playbook: 'alpha' },
        { kind: 'run', run: runId },
        { order: 'asc', limit: 10 },
      ),
    ),
  );
  return records.map(({ type, context }) => ({ type, test: context.test }));
}
