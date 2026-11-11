import type { Outcome } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../index.ts';
import type { PlaybookOperation } from '../operations/definition-operations.ts';
import type { ReadModelStage } from '../read-model-staging/read-model-stage.ts';
import { comparedMessage } from '../read-model-staging/shadow-comparison.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const greet = { type: 'echo', name: 'greet' };

const weekly = { type: 'workflow', name: 'weekly' };

const everyMonday = {
  kind: 'cron',
  reference: '/schedule/cron',
  expression: '0 9 * * 1',
  time_zone: 'Europe/Amsterdam',
};

function echoing(greeting: string): string {
  return JSON.stringify({ greeting, warnings: ['The greeting is never checked'], triggers: [everyMonday] });
}

const callingGreet = JSON.stringify({
  calls: [
    {
      ...greet,
      steps: [
        { number: 1, name: 'greet-1' },
        { number: 3, name: 'greet-3' },
      ],
    },
  ],
});

type Step = readonly [PlaybookOperation, Readonly<Record<string, unknown>>, string?];

function scriptFor(workflow: Capability): readonly Step[] {
  const operations = definitionOperationsFor([echo, workflow]);
  return [
    [operations.createDefinition, { ...greet, source: echoing('Hello') }],
    [operations.createDefinition, { ...weekly, source: callingGreet }],
    [operations.updateDefinition, { ...greet, source: echoing('Hi') }, '2026-10-02T09:00:00.000Z'],
    [operations.getDefinition, greet],
    [operations.getDefinition, weekly],
    [operations.listDefinitions, { type: 'echo' }],
    [operations.pauseDefinition, { ...greet, reason: 'The greeting is checked again' }, '2026-10-03T09:00:00.000Z'],
    [operations.runDefinition, { ...greet, run_id: '0199a3c4-7d2e-7c1a-9b3f-0000000000a1' }],
    [operations.getDefinition, greet],
    [operations.resumeDefinition, greet, '2026-10-04T09:00:00.000Z'],
    [operations.runDefinition, { ...greet, run_id: '0199a3c4-7d2e-7c1a-9b3f-0000000000a2' }],
    [operations.retireDefinition, weekly, '2026-10-05T09:00:00.000Z'],
    [operations.listDefinitions, { type: 'workflow', include_retired: true }],
    [operations.restoreDefinition, weekly, '2026-10-06T09:00:00.000Z'],
    [operations.getDefinition, { type: 'echo', name: 'missing' }],
    [operations.listDefinitions, { type: 'workflow' }],
  ];
}

export function answeredBy(definitions: Harness, workflow: Capability): Promise<readonly Outcome[]> {
  return Effect.runPromise(
    Effect.forEach(scriptFor(workflow), ([operation, input, at]) =>
      Effect.promise(() => definitions.call(operation, toAlpha(acmeAdmin, input), at)),
    ),
  );
}

function comparedIn(definitions: Harness): readonly (readonly unknown[])[] {
  return definitions
    .logged()
    .filter(({ message }) => message === comparedMessage)
    .map(({ annotations }) => [annotations['read'], annotations['outcome'], annotations['differing']]);
}

export async function staged(stage: ReadModelStage, workflow: Capability) {
  const definitions = harness(undefined, undefined, { stage, folds: ['echo', 'workflow'] });
  return { answers: await answeredBy(definitions, workflow), compared: comparedIn(definitions) };
}
