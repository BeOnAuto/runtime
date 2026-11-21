import {
  Caller,
  Ledger,
  PlaybookContext,
  playbookLedgerOf,
  type PlaybookReader,
  type PlaybookWriter,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { controls, experiments, oneOff } from '../goals/goal-examples.ts';
import { playbookGoalsSaved } from '../goals/goals-saved.ts';
import { playbookGoalRenamed } from '../renaming/goal-renamed.ts';
import { goalRenamerOf } from '../renaming/goal-servers.ts';
import { acmeAdmin, savedIn } from './callers.ts';
import { goalsDocumentOfTheExamples } from './goals-book.ts';
import { answerOf, movingCapabilities, operations, toAlpha, type Definitions } from './moving.ts';
import { uncheckedPages } from './page-ports.ts';

export const renamer = goalRenamerOf(movingCapabilities, { pages: uncheckedPages });

type InThePlaybook = PlaybookReader | PlaybookWriter | PlaybookContext | Caller;

export function inAlphaOf(definitions: Definitions) {
  return <A, E>(work: Effect.Effect<A, E, InThePlaybook>) =>
    definitions.run(
      Effect.result(
        Effect.flatMap(Effect.service(Ledger), (ledger) =>
          work.pipe(
            Effect.provide(playbookLedgerOf(ledger, savedIn)),
            Effect.provideService(PlaybookContext, savedIn),
            Effect.provideService(Caller, acmeAdmin),
          ),
        ),
      ),
    );
}

function contributing(...goals: readonly string[]): string {
  return JSON.stringify({ contributes: goals.map((goal) => ({ goal, purpose: `Counts toward ${goal}` })) });
}

const servingWorkflows: Readonly<Record<string, string>> = {
  intake: contributing(oneOff.id, experiments.id, controls.id, experiments.id),
  scoring: contributing(experiments.id),
  held: contributing(experiments.id),
  gone: contributing(experiments.id),
  checks: contributing(controls.id),
  quiet: '{}',
};

export function goalsListedIn(definitions: Definitions, goals: readonly unknown[]) {
  return inAlphaOf(definitions)(
    playbookGoalsSaved({ document: goalsDocumentOfTheExamples(goals), assessed: new Set() }),
  );
}

export function workflowSavedIn(definitions: Definitions, name: string, source: string) {
  return definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { type: 'workflow', name, source }));
}

export function runOf(definitions: Definitions, name: string) {
  return definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { type: 'workflow', name, input: {} }));
}

export async function goalsServedIn(definitions: Definitions): Promise<void> {
  await goalsListedIn(definitions, [experiments, controls, oneOff]);
  await Promise.all(
    Object.entries(servingWorkflows).map(([name, source]: readonly [string, string]) =>
      workflowSavedIn(definitions, name, source),
    ),
  );
  await definitions.call(operations.pauseDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'held' }));
  await definitions.call(operations.retireDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'gone' }));
}

export function goalRenamedIn(definitions: Definitions, from: string, to: string) {
  return inAlphaOf(definitions)(playbookGoalRenamed(renamer, { from, to }));
}

export async function workflowAsSaved(definitions: Definitions, name: string) {
  const read = await definitions.call(operations.getDefinition, toAlpha(acmeAdmin, { type: 'workflow', name }));
  return answerOf(read);
}
