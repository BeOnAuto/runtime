import { admittedByTheMeter, agentActionOf } from '@on.auto/definitions';
import { Caller, PlaybookContext, type Conflict, type Unavailable } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import { memoryDefinitionType } from '../capability/memory-run.ts';
import type { MemoryPlace } from '../facts/memory-streams.ts';
import type { Acting } from '../keeper/memory-keeper.ts';

export interface AgentAction {
  readonly place: MemoryPlace;
  readonly acting: Acting;
}

export const actingNow: Effect.Effect<AgentAction, never, PlaybookContext | Caller> = Effect.gen(function* () {
  const { org, playbook } = yield* PlaybookContext;
  const { id: by } = yield* Caller;
  const at = new Date(yield* Clock.currentTimeMillis).toISOString();
  return { place: { org, playbook }, acting: { context: { at, by } } };
});

export function admitted(
  { place, acting }: AgentAction,
  operation: 'remember' | 'recall' | 'forget',
  id: string,
): Effect.Effect<void, Conflict | Unavailable> {
  const { org, playbook } = place;
  return admittedByTheMeter(
    agentActionOf({ org, playbook, type: memoryDefinitionType, operation, id, by: acting.context.by }),
  );
}
