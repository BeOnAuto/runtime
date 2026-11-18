import type { Fold, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { loadEachHeld } from '../operations/registry-access.ts';
import type { RecordedDefinitionEvent } from '../registry/definition-events.ts';
import type { DefinitionState, RegisteredDefinition } from '../registry/definition-registry.ts';
import { definitionFoldOf } from '../registry/definitions-decider.ts';

interface WorkflowsArmed {
  readonly workflows: readonly RegisteredDefinition[];
  readonly armedAt?: number;
}

const armingTypes: ReadonlySet<string> = new Set([
  'definition_created',
  'definition_updated',
  'definition_resumed',
  'definition_restored',
]);

interface ArmingWorkflow {
  readonly definition: DefinitionState;
  readonly armedAt: number;
}

function armingFoldOf(definition: string): Fold<ArmingWorkflow, RecordedDefinitionEvent> {
  const fold = definitionFoldOf(definition);
  return {
    initialState: { definition: fold.initialState, armedAt: -Infinity },
    eventSchema: fold.eventSchema,
    evolve: (state, event) => ({
      definition: fold.evolve(state.definition, event),
      armedAt: armingTypes.has(event.type) ? Date.parse(event.context.at) : state.armedAt,
    }),
  };
}

function armedOf(arming: readonly ArmingWorkflow[]): WorkflowsArmed {
  const latest = Math.max(-Infinity, ...arming.map(({ armedAt }) => armedAt));
  const workflows = arming
    .map(({ definition }) => definition)
    .filter((definition): definition is RegisteredDefinition => definition !== undefined);
  return Number.isFinite(latest) ? { workflows, armedAt: latest } : { workflows };
}

export const workflowsArmed: Effect.Effect<WorkflowsArmed, never, PlaybookReader> = Effect.map(
  loadEachHeld('workflow', armingFoldOf),
  armedOf,
);
