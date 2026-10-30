import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';

import { tokenSha256Of } from '../links/link-token.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { actedNow, loadRegistry, recordChangeInRegistry } from '../operations/registry-access.ts';
import { shownConnection } from '../operations/shown-connections.ts';
import { clientGivenConnectionOf } from '../registry/own-app-decisions.ts';
import { nextClientOf, releasedClientsForgottenOf } from './consent-asking.ts';
import { ClientGivenSchema, GivingTheClientSchema, clientUnkeptOf } from './given-fields.ts';

type ClientGiving = Pick<ConnectionServices, 'secrets'> & { readonly bindsPerson: boolean };

export function defineGiveClient(services: ClientGiving) {
  const { secrets, bindsPerson } = services;
  return defineHttpOperation('org', 'command', {
    name: 'give_client',
    title: 'Give client',
    description: [
      "Gives the client id and the client secret of the org's own app, an app the org registered with the provider, for a connection under that app, through its open link, before the person signs in.",
      'The runtime keeps the client secret sealed in its secret store, and no answer, record or history of the org ever holds it; the record keeps the client id.',
      'The link stays open, and its consent then starts with this client.',
      'A connection that holds no tokens yet, or is given the client id it runs under, takes the client at once, its secret replacing the one before; another client id given while it holds tokens is kept as its next client, which its next sign-in takes and which replaces its client once that sign-in finishes, so the record shows the client it runs under until then and next_client_id the client given.',
      'Where the secret store cannot keep the secret just now, it answers unavailable in the words of the store and keeps nothing.',
      'On a runtime that signs people in, only the person who added the connection may give it.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/client' },
    body: { kind: 'json' },
    inputSchema: GivingTheClientSchema,
    outputSchema: ClientGivenSchema,
    reasons: ['not_found', 'forbidden', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* (giving) {
      const use = { connection: giving.id, token_sha256: tokenSha256Of(giving.token), bindsPerson };
      const kept = yield* Effect.fromResult(clientGivenConnectionOf(yield* loadRegistry, use, yield* actedNow));
      const secretId = yield* secrets
        .keep(Redacted.make(giving.client_secret))
        .pipe(Effect.mapError((failure) => clientUnkeptOf(kept.connection.name, failure)));
      const { before, after } = yield* recordChangeInRegistry({
        type: 'give_client',
        ...use,
        client_id: giving.client_id,
        secret_id: secretId,
      }).pipe(Effect.onError(() => secrets.forget(secretId)));
      yield* releasedClientsForgottenOf(before, after, services);
      return { ...(yield* shownConnection(secrets, after)), ...nextClientOf(after) };
    }),
  });
}
