import { Caller, defineCommand, mayCallEach, type Runnable } from '@on.auto/operations';
import { Effect } from 'effect';

import { adderRefusalOf, approvingAskedOf } from '../policy/policy-rules.ts';
import { AddedSchema, AdditionSchema, type AdditionGiven } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { addedWordsOf, additionAttempted, linkOffering } from './connection-words.ts';
import { addedAnswerOf, admittedAsARequest, admittedWithItsLink, answeredWithItsLink } from './linked-additions.ts';
import { recordedAdditionOf, recordedRequestOf } from './recorded-additions.ts';

const description = [
  "Starts connecting a person's account at a service, by the name of a provider that search lists, or a server given by hand as name, type, entry and credential.",
  "Once approved, the connection's tools serve the org's playbooks.",
  'Work out first what the runs will do at the service and what must exist there, and ask for the access both take; the guide connect-a-service says how.',
  'An MCP server given by hand says how it authenticates: leave its credential out unless the answer says it names none, and a secret takes instructions and key_page.',
  "It answers pending with a link to Studio's page, where the person approves it within 24 hours.",
  'If the person may not approve the connection, it sends the admins a request and answers no link.',
  'Nothing is granted by this call and no credential passes through it.',
].join(' ');

const addedWithItsLink = Effect.fnUntraced(function* (given: AdditionGiven, services: ConnectionServices) {
  const admitted = yield* admittedWithItsLink(given, given.more, services);
  const kept = yield* recordedAdditionOf(services, admitted.described, admitted.link);
  return yield* answeredWithItsLink(kept, admitted, services);
});

const addedAsARequest = Effect.fnUntraced(function* (given: AdditionGiven, services: ConnectionServices) {
  const described = yield* admittedAsARequest(given, given.more, services);
  return addedAnswerOf(yield* recordedRequestOf(services, described, given.message), services);
});

export function defineAddConnection(services: ConnectionServices, approving: Runnable<'org'>) {
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
      const caller = yield* Caller;
      const adderRefusal = adderRefusalOf(access, caller);
      if (adderRefusal !== undefined) {
        return yield* Effect.fail(adderRefusal);
      }
      const [mayApprove] = yield* mayCallEach([approvingAskedOf(approving, caller)]);
      return yield* mayApprove === true ? addedWithItsLink(input, services) : addedAsARequest(input, services);
    }),
    plainLanguage: {
      task: 'add a connection',
      attempt: additionAttempted,
      outcome: (added, { more }) => addedWordsOf(added, providers, more),
    },
    ...linkOffering(services),
  });
}
