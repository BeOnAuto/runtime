import type { Outcome } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../index.ts';
import type { PlaybookOperation } from '../operations/definition-operations.ts';
import type { ReadModelStage } from '../read-model-staging/read-model-stage.ts';
import { comparedMessage } from '../read-model-staging/shadow-comparison.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { renamedIn, type Renamed } from '../testing/renaming.ts';
import { playbookWithGoals, scriptOperationsFor, weeklyContributes } from './script-operations.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const greet = { type: 'echo', name: 'greet' };

const weekly = { type: 'workflow', name: 'weekly' };

const monthly = { type: 'workflow', name: 'monthly' };

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
  contributes: weeklyContributes,
});

type Step =
  | readonly [PlaybookOperation, Readonly<Record<string, unknown>>, string?]
  | { readonly renamed: Renamed; readonly at: string };

function scriptFor(workflow: Capability, goals: boolean): readonly Step[] {
  const operations = scriptOperationsFor(workflow, goals);
  return [
    [operations.savePlaybook, playbookWithGoals],
    [operations.createDefinition, { ...greet, source: echoing('Hello') }],
    [operations.createDefinition, { ...weekly, source: callingGreet }],
    [operations.updateDefinition, { ...greet, source: echoing('Hi') }, '2026-10-02T09:00:00.000Z'],
    { renamed: { type: 'workflow', from: 'weekly', to: 'monthly' }, at: '2026-10-02T10:00:00.000Z' },
    [operations.updateDefinition, { ...monthly, source: callingGreet }, '2026-10-02T11:00:00.000Z'],
    [operations.getDefinition, greet],
    [operations.getDefinition, monthly],
    [operations.listDefinitions, { type: 'echo' }],
    [operations.pauseDefinition, { ...greet, reason: 'The greeting is checked again' }, '2026-10-03T09:00:00.000Z'],
    [operations.runDefinition, { ...greet, run_id: '0199a3c4-7d2e-7c1a-9b3f-0000000000a1' }],
    [operations.getDefinition, greet],
    [operations.resumeDefinition, greet, '2026-10-04T09:00:00.000Z'],
    [operations.runDefinition, { ...greet, run_id: '0199a3c4-7d2e-7c1a-9b3f-0000000000a2' }],
    [operations.retireDefinition, monthly, '2026-10-05T09:00:00.000Z'],
    [operations.listDefinitions, { type: 'workflow', include_retired: true }],
    [operations.restoreDefinition, monthly, '2026-10-06T09:00:00.000Z'],
    [operations.getDefinition, { type: 'echo', name: 'missing' }],
    [operations.listDefinitions, { type: 'workflow' }],
  ];
}

function answerOf(definitions: Harness, step: Step): Promise<readonly Outcome[]> {
  if ('renamed' in step) {
    return renamedIn(definitions, step.renamed, step.at).then(() => []);
  }
  const [operation, input, at] = step;
  return definitions.call(operation, toAlpha(acmeAdmin, input), at).then((outcome) => [outcome]);
}

export function answeredBy(definitions: Harness, workflow: Capability, goals: boolean): Promise<readonly Outcome[]> {
  return Effect.runPromise(
    Effect.map(
      Effect.forEach(scriptFor(workflow, goals), (step) => Effect.promise(() => answerOf(definitions, step))),
      (answers: readonly (readonly Outcome[])[]) => answers.flat(),
    ),
  );
}

function comparedIn(definitions: Harness): readonly (readonly unknown[])[] {
  return definitions
    .logged()
    .filter(({ message }) => message === comparedMessage)
    .map(({ annotations }) => [annotations['read'], annotations['outcome'], annotations['differing']]);
}

export async function staged(stage: ReadModelStage, workflow: Capability, goals: boolean) {
  const definitions = harness(undefined, undefined, { stage, folds: ['echo', 'workflow'] });
  return { answers: await answeredBy(definitions, workflow, goals), compared: comparedIn(definitions) };
}
