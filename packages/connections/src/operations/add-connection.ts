import { Caller, OrgContext, defineCommand, quoted, randomUUIDv7 } from '@on.auto/operations';
import { Effect } from 'effect';

import { additionIssuesOf, conflictAsTakenByTheFile, invalidAddition } from '../entries/entry-checks.ts';
import { connectPageOf } from '../links/connect-page.ts';
import { issuedLink } from '../links/link-token.ts';
import { adderRefusalOf, policyRefusalOf } from '../policy/policy-rules.ts';
import { AddedSchema, AdditionSchema } from './connection-fields.ts';
import type { ConnectionServices } from './connection-services.ts';
import { connectionNamed, linkWords } from './connection-words.ts';
import { recordInRegistry } from './registry-access.ts';

const description = [
  "Adds a tool server to the org as a connection, which its playbooks may use, and answers it pending with a link to Studio's page.",
  'Use it when the person wants a function to reach a server the runtime does not set up; search lists the servers there are.',
  'The entry holds no credential: the person approves the connection, and gives its credential, on the page the link opens within ten minutes.',
].join(' ');

export function defineAddConnection({ policy, fileEntries, modelProviders, pages, access }: ConnectionServices) {
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
      const issues = additionIssuesOf(input, { org, modelProviders });
      if (issues.length > 0) {
        return yield* Effect.fail(invalidAddition(issues));
      }
      const refusal = policyRefusalOf(policy, input);
      if (refusal !== undefined) {
        return yield* Effect.fail(refusal);
      }
      if (fileEntries.includes(input.name)) {
        return yield* Effect.fail(conflictAsTakenByTheFile(input.name));
      }
      const { token, ...link } = yield* issuedLink;
      const { name, kind, entry, credential } = input;
      const connection = randomUUIDv7();
      const kept = yield* recordInRegistry({ type: 'add', connection, name, kind, entry, credential, link }).pipe(
        Effect.catchTags({ not_found: Effect.die, forbidden: Effect.die }),
      );
      const url = connectPageOf(pages, { org, connection, token });
      return { ...kept.connection, credential_ends_with: null, connect: { url, expires_at: link.expires_at } };
    }),
    plainLanguage: {
      task: 'add a connection',
      attempt: ({ name }) => `add the connection ${quoted(name)}`,
      outcome: (added) => `Added ${connectionNamed(added)}. ${linkWords}`,
    },
    linkToOpen: (added) => ({
      message: `Open this page to approve ${connectionNamed(added)}, and give its credential where it takes one, within ten minutes.`,
      url: added.connect.url,
    }),
  });
}
