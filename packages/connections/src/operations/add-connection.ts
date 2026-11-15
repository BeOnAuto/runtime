import { Caller, defineCommand } from '@on.auto/operations';
import { Effect } from 'effect';

import { adderRefusalOf } from '../policy/policy-rules.ts';
import { AddedSchema, AdditionSchema } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { addedWordsOf, additionAttempted, linkOffering } from './connection-words.ts';
import { admittedWithItsLink, answeredWithItsLink } from './linked-additions.ts';
import { recordedAdditionOf } from './recorded-additions.ts';

const description = [
  "Starts connecting a person's account at a service, by the name of a provider that search lists, or a server given by hand as name, type, entry and credential.",
  "Once approved, the connection's tools serve the org's playbooks.",
  'Work out first what the runs will do at the service and what must exist there, and ask for the access both take; the guide connect-a-service says how.',
  'With more, a group the provider offers beyond its first consent, the page asks its scopes too.',
  'An MCP server given by hand says how it authenticates: leave its credential out unless the answer says it names none, and a secret takes instructions and key_page.',
  "It answers pending with a link to Studio's page, where the person approves it within 24 hours.",
  'Nothing is granted by this call and no credential passes through it.',
].join(' ');

export function defineAddConnection(services: ConnectionServices) {
  const { access, providers } = services;
  return defineCommand('org', {
    name: 'add_connection',
    title: 'Add connection',
    description,
    route: { method: 'POST', path: '/connections' },
    successStatus: 201,
    inputSchema: AdditionSchema,
    outputSchema: AddedSchema,
    reasons: ['invalid_input', 'forbidden', 'conflict', 'unavailable'],
    handle: Effect.fnUntraced(function* (input) {
      const adderRefusal = adderRefusalOf(access, yield* Caller);
      if (adderRefusal !== undefined) {
        return yield* Effect.fail(adderRefusal);
      }
      const admitted = yield* admittedWithItsLink(input, input.more, services);
      const kept = yield* recordedAdditionOf(services, admitted.described, admitted.link);
      return yield* answeredWithItsLink(kept, admitted, services);
    }),
    plainLanguage: {
      task: 'add a connection',
      attempt: additionAttempted,
      outcome: (added, { more }) => addedWordsOf(added, providers, more),
    },
    ...linkOffering(services),
  });
}
