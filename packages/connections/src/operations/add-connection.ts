import { Caller, OrgContext, defineCommand, quoted } from '@on.auto/operations';
import { Effect } from 'effect';

import { connectPageOf, studioBaseFor } from '../links/connect-page.ts';
import { issuedLink } from '../links/link-token.ts';
import { adderRefusalOf } from '../policy/policy-rules.ts';
import { checkedAdditionOf, refusalOfTheAddition } from '../providers/provider-additions.ts';
import { AddedSchema, AdditionSchema } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { connectionNamed, linkWords } from './connection-words.ts';
import { additionOf, recordInRegistry } from './registry-access.ts';

const description = [
  "Starts connecting a person's account at a service, named by a provider that search lists, by its name and placeholders, answered pending with a link to Studio's page.",
  'A server given by hand takes name, type, entry and credential instead, none holding a secret.',
  'The person approves it, and gives its credential, on the page the link opens within ten minutes.',
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
    reasons: ['invalid_input', 'forbidden', 'conflict'],
    handle: Effect.fnUntraced(function* (input) {
      const adderRefusal = adderRefusalOf(access, yield* Caller);
      if (adderRefusal !== undefined) {
        return yield* Effect.fail(adderRefusal);
      }
      const { org } = yield* OrgContext;
      const studioBase = studioBaseFor(pages);
      const given = yield* checkedAdditionOf(input, { org, modelProviders }, { ...serving, policy, studioBase });
      const refusal = refusalOfTheAddition(given, policy, fileEntries, serving);
      if (refusal !== undefined) {
        return yield* Effect.fail(refusal);
      }
      const { token, ...link } = yield* issuedLink;
      const addition = additionOf(given, link);
      const kept = yield* recordInRegistry(addition).pipe(
        Effect.catchTags({ not_found: Effect.die, forbidden: Effect.die, invalid_input: Effect.die }),
      );
      const url = connectPageOf(pages, { org, connection: addition.connection, token });
      return { ...kept.connection, credential_ends_with: null, connect: { url, expires_at: link.expires_at } };
    }),
    plainLanguage: {
      task: 'add a connection',
      attempt: ({ name, provider }) =>
        name === undefined ? `connect the provider ${quoted(String(provider))}` : `add the connection ${quoted(name)}`,
      outcome: (added) => `Added ${connectionNamed(added)}. ${linkWords}`,
    },
    linkToOpen: (added) => ({
      message: `Open this page to approve ${connectionNamed(added)}, and give its credential where it takes one, within ten minutes.`,
      url: added.connect.url,
    }),
  });
}
