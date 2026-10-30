import { Caller, defineQuery, canAccessPlaybook } from '@on.auto/operations';
import { Effect, Order, Schema } from 'effect';

import { playbooksListed } from '../plain-language/playbook-words.ts';
import { PlaybookSchema, type Playbook } from '../registry/playbook.ts';
import { loadRegistry } from './registry-loading.ts';

const byId = Order.mapInput(Order.String, ({ id }: Playbook) => id);

export const listPlaybooks = defineQuery('org', {
  name: 'list_playbooks',
  title: 'List playbooks',
  description: [
    'Use it when the person speaks of their playbooks, or wants something done that one of them may cover.',
    'Lists the playbooks of the org that the caller may access, sorted by id.',
    'Each holds every field of the playbook, such as its name, what it is for and whether it is active.',
  ].join(' '),
  route: { method: 'GET', path: '/playbooks' },
  permittedBy: ['org:read', 'playbook:read'],
  inputSchema: Schema.Struct({
    include_retired: Schema.optionalKey(
      Schema.Boolean.annotate({ description: 'Whether to list retired playbooks as well; false when left out' }),
    ),
  }),
  outputSchema: Schema.Struct({ playbooks: Schema.Array(PlaybookSchema) }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ include_retired: includeRetired = false }) {
    const { playbooks: access } = yield* Caller;
    const registry = yield* loadRegistry;
    const playbooks = [...registry.values()].filter(
      ({ id, status }) => canAccessPlaybook(access, id) && (includeRetired || status === 'active'),
    );
    return { playbooks: playbooks.toSorted(byId) };
  }),
  plainLanguage: {
    task: 'list the playbooks',
    attempt: () => 'list the playbooks',
    outcome: ({ playbooks }) => playbooksListed(playbooks),
  },
});
