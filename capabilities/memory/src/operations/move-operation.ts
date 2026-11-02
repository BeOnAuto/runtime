import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { keptHere, type MemoryPorts } from '../capability/memory-ports.ts';
import { MemoryScopeSchema } from '../facts/memory-facts.ts';
import { moved } from '../move/moving.ts';
import { actingNow } from './agent-actions.ts';
import { MemoryIdField } from './memory-fields.ts';
import { RememberedSchema } from './memory-outputs.ts';

const MoveInputSchema = Schema.Struct({
  id: MemoryIdField,
  to: MemoryScopeSchema.annotate({
    description: 'Who keeps the memory from now on: the playbook, or its organization',
  }),
});

export function defineMoveMemory(ports: MemoryPorts) {
  return defineHttpOperation('playbook', 'command', {
    name: 'move_memory',
    title: 'Move a memory',
    description:
      "Moves a memory from the playbook's memories to its organization's, or back, as a new memory under a new id, which it answers; the memory moved stays in the history as moved. Asked again, it completes a move cut short and answers the same.",
    route: { method: 'POST', path: '/memories/{id}/move' },
    body: { kind: 'json' },
    inputSchema: MoveInputSchema,
    outputSchema: RememberedSchema,
    reasons: ['invalid_input', 'not_found', 'conflict'],
    handle: Effect.fnUntraced(function* (input: typeof MoveInputSchema.Type) {
      yield* keptHere(ports, input.to, '/to');
      const { place, acting } = yield* actingNow;
      return yield* moved(ports, place, input, acting);
    }),
  });
}
