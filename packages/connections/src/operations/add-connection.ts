import { Caller, OrgContext, defineCommand } from '@on.auto/operations';
import { Effect } from 'effect';

import { connectOf, studioBaseFor } from '../links/connect-page.ts';
import { adderRefusalOf } from '../policy/policy-rules.ts';
import { admittedAdditionOf } from './admitted-additions.ts';
import { AddedSchema, AdditionSchema } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { addedWordsOf, additionAttempted, linkOffering } from './connection-words.ts';
import { additionLinkIssuedFor } from './more-asked.ts';
import { additionOf, recordInRegistry, recordedCaller } from './registry-access.ts';

const description = [
  "Starts connecting a person's account at a service, by the name of a provider that search lists, or a server given by hand as name, type, entry and credential.",
  "Once approved, the connection's tools serve the org's playbooks.",
  'Work out first what the runs will do at the service and what must exist there, and ask for the access both take; the guide connect-a-service says how.',
  'With more, a group the provider offers beyond its first consent, the page asks its scopes too.',
  'An MCP server given by hand says how it authenticates: leave its credential out unless the answer says it names none, and a secret takes instructions and key_page.',
  "It answers pending with a link to Studio's page, where the person approves it within 24 hours.",
  'Nothing is granted by this call and no credential passes through it.',
].join(' ');

export function defineAddConnection({
  policy,
  fileEntries,
  modelProviders,
  pages,
  access,
  ...serving
}: ConnectionServices) {
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
      const { org } = yield* OrgContext;
      const studioBase = studioBaseFor(pages);
      const given = yield* admittedAdditionOf(input, {
        ...serving,
        org,
        modelProviders,
        policy,
        fileEntries,
        studioBase,
      });
      const { token, ...link } = yield* additionLinkIssuedFor(given, input.more, { ...serving, pages });
      const addition = additionOf(given, link, yield* recordedCaller);
      const kept = yield* recordInRegistry(addition).pipe(
        Effect.catchTags({ not_found: Effect.die, forbidden: Effect.die, invalid_input: Effect.die }),
      );
      const connect = connectOf(pages, { org, connection: addition.connection, token }, link.expires_at);
      return { ...kept.connection, credential_ends_with: null, connect };
    }),
    plainLanguage: {
      task: 'add a connection',
      attempt: additionAttempted,
      outcome: (added, { more }) => addedWordsOf(added, serving.providers, more),
    },
    ...linkOffering(serving.secrets),
  });
}
