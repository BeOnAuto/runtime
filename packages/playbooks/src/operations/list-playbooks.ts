import { Caller, defineQuery, canAccessPlaybook, type CallerIdentity } from '@on.auto/operations';
import { studioLinkTo } from '@on.auto/operations/studio-links';
import { Effect, Order, Schema } from 'effect';

import { playbooksListed, welcomeOf } from '../plain-language/playbook-words.ts';
import { PlaybookSchema, type Playbook } from '../registry/playbook.ts';
import { loadRegistry } from './registry-loading.ts';

const byId = Order.mapInput(Order.String, ({ id }: Playbook) => id);

function mayStartTheOrg({ playbooks, permissions }: CallerIdentity): boolean {
  return playbooks === '*' && permissions.includes('org:write');
}

const WelcomeField = Schema.String.annotate({
  description:
    "Where the org has no playbook yet and the caller may make one there, words the agent relays to the person: what a playbook is, three ways to start, and what Studio shows, with Studio's link where the runtime knows its address",
});

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
  outputSchema: Schema.Struct({ playbooks: Schema.Array(PlaybookSchema), welcome: Schema.optionalKey(WelcomeField) }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ include_retired: includeRetired = false }) {
    const caller = yield* Caller;
    const registry = yield* loadRegistry;
    if (registry.size === 0 && mayStartTheOrg(caller)) {
      return { playbooks: [], welcome: welcomeOf(yield* studioLinkTo()) };
    }
    const playbooks = [...registry.values()].filter(
      ({ id, status }) => canAccessPlaybook(caller.playbooks, id) && (includeRetired || status === 'active'),
    );
    return { playbooks: playbooks.toSorted(byId) };
  }),
  plainLanguage: {
    task: 'list the playbooks',
    attempt: () => 'list the playbooks',
    outcome: ({ playbooks }) => playbooksListed(playbooks),
    relayed: ({ welcome }) => welcome,
  },
});
