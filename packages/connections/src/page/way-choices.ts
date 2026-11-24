import { defineHttpOperation } from '@on.auto/operations';
import { Effect } from 'effect';

import { tokenSha256Of } from '../links/link-token.ts';
import { loadRegistry, recordChangeInRegistry } from '../operations/registry-access.ts';
import { ConnectionSchema, connectionShown } from '../registry/connection.ts';
import { linkedConnectionOf } from '../registry/registry-lookup.ts';
import { credentialChosenFor, type WayChoosing } from './chosen-ways.ts';
import { forgottenVerifierOf, releasedClientsForgottenOf } from './consent-asking.ts';
import { serviceAccountRemovedBefore } from './service-account-ports.ts';
import { ChoosingTheWaySchema } from './way-fields.ts';

export function defineChooseWay(services: WayChoosing) {
  return defineHttpOperation('org', 'command', {
    name: 'choose_way',
    title: 'Choose way',
    description: [
      'Chooses how a connection that is not connected yet connects, through its open link: one of the ways its provider or its server offers, the values that way asks for, and the account type where that way acts as an account.',
      'The connection keeps its id, its name, its playbooks and its link.',
      "A sign-in started and the organization's own OAuth client given for the way it had before are dropped.",
      'When another way is chosen without an account type, the type is personal if the way takes personal accounts, and otherwise the type the way takes.',
      "Choosing the way the connection already has with other values records the choice again: a sign-in started and the organization's own OAuth client given are dropped, and the account type stays as it is unless one is given.",
      'Choosing the way the connection already has with the same values changes only its account type, where one is given, and otherwise records nothing.',
      "A way the connection's provider or server does not offer is refused as invalid_input, and so are an account type the way does not take, a value the way asks for that is missing or does not fit, and a value the way does not ask for.",
      'A connection that is connected or broken is refused as conflict.',
      'Choosing another way for a connection that acts as a service account Auto created removes that account first; where Auto cannot remove it now, the choice is refused as unavailable and nothing is changed.',
      "A way the runtime's rules do not allow is refused as forbidden.",
      'On a runtime that signs people in, only an admin of the organization may choose.',
    ].join(' '),
    route: { method: 'PUT', path: '/connections/{id}/way' },
    body: { kind: 'json' },
    repeatable: true,
    connectionsManagement: true,
    inputSchema: ChoosingTheWaySchema,
    outputSchema: ConnectionSchema,
    reasons: ['not_found', 'forbidden', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id, token, credential, account_type: accountType, placeholders }) {
      const use = { connection: id, token_sha256: tokenSha256Of(token) };
      const asked = {
        credential,
        ...(accountType === undefined ? {} : { account_type: accountType }),
        ...(placeholders === undefined ? {} : { placeholders }),
      };
      const kept = yield* Effect.fromResult(linkedConnectionOf(yield* loadRegistry(services), use));
      const chosen = yield* credentialChosenFor(kept, asked, services);
      if (credential.service_account !== 'managed') {
        yield* serviceAccountRemovedBefore(kept, services);
      }
      const { before, after } = yield* recordChangeInRegistry(services, {
        type: 'choose_way',
        ...use,
        ...chosen,
        ...(accountType === undefined ? {} : { account_type: accountType }),
      });
      yield* releasedClientsForgottenOf(before, after, services);
      yield* after.consent === undefined ? forgottenVerifierOf(before, services) : Effect.void;
      return connectionShown(after.connection, null);
    }),
  });
}
