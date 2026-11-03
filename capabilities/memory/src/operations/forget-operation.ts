import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { MemoryPorts } from '../capability/memory-ports.ts';
import { foundIn, forgotten } from '../forget/forgetting.ts';
import { actingNow, admitted } from './agent-actions.ts';
import { MemoryIdField } from './memory-fields.ts';
import { ForgottenSchema } from './memory-outputs.ts';

const description = [
  'Forgets a memory, so no recall finds it any more; its history still shows that it was kept.',
  'Use it when the person says a memory is wrong or no longer holds; to correct one, remember the new text with `replaces`.',
  "`erase` true also erases its text from the playbook's ledger, every version of it and wherever it was moved, for what must not be kept at all; who wrote it and when stay.",
  'Forgetting a memory forgotten already answers as before.',
].join(' ');

const ForgetInputSchema = Schema.Struct({
  id: MemoryIdField,
  erase: Schema.optionalKey(
    Schema.Boolean.annotate({ description: 'Whether to erase its text from the ledger too; false when left out' }),
  ),
});

export function defineForget(ports: MemoryPorts) {
  return defineCommand('playbook', {
    name: 'forget',
    title: 'Forget a memory',
    description,
    route: { method: 'POST', path: '/memories/{id}/forget' },
    irreversible: true,
    repeatable: true,
    inputSchema: ForgetInputSchema,
    outputSchema: ForgottenSchema,
    reasons: ['not_found', 'conflict', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id, erase = false }: typeof ForgetInputSchema.Type) {
      const action = yield* actingNow;
      const found = yield* foundIn(ports, action.place, id);
      yield* admitted(action, 'forget', id);
      return yield* forgotten(ports, found, erase, action.acting);
    }),
    plainLanguage: {
      task: 'forget a memory',
      attempt: () => 'forget the memory',
      outcome: ({ status }) =>
        status === 'erased'
          ? 'The memory is forgotten, and its text is erased from the ledger.'
          : 'The memory is forgotten: no recall finds it any more.',
    },
  });
}
