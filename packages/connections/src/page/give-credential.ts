import { allPermissions, defineHttpOperation, OrgContext } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';

import { tokenSha256Of } from '../links/link-token.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { actedNow, loadRegistry, recordInRegistry } from '../operations/registry-access.ts';
import { providingOf } from '../providers/provider-additions.ts';
import { ConnectionSchema, connectionShown } from '../registry/connection.ts';
import { linkedConnectionOf } from '../registry/registry-lookup.ts';
import { GivingSchema, givenOf, unkeptRefusalOf } from './given-fields.ts';

export function defineGiveCredential({
  secrets,
  modelProviders,
  providers,
  providerValues,
  bindsPerson,
}: Pick<ConnectionServices, 'secrets' | 'modelProviders' | 'providers' | 'providerValues'> & {
  readonly bindsPerson: boolean;
}) {
  return defineHttpOperation('org', 'command', {
    name: 'give_credential',
    title: 'Give credential',
    description: [
      'Gives the credential of a connection through its open link, which approves the connection and uses the link up, and answers it connected.',
      'The runtime keeps the value sealed in its secret store, and no answer, record or history of the org ever holds it.',
      'Where the secret store cannot keep it just now, it answers unavailable in the words of the store, keeps nothing and leaves the link open, so the same credential is given again.',
      'On a runtime that signs people in, only the person who added the connection may give it.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/credential' },
    body: { kind: 'json' },
    permittedBy: allPermissions,
    inputSchema: GivingSchema,
    answer: { kind: 'json', outputSchema: ConnectionSchema },
    reasons: ['not_found', 'forbidden', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* (giving) {
      const use = { connection: giving.id, token_sha256: tokenSha256Of(giving.token), bindsPerson };
      const kept = yield* Effect.fromResult(linkedConnectionOf(yield* loadRegistry, use, yield* actedNow));
      const { org } = yield* OrgContext;
      const providing = providingOf(kept.connection, { providers, providerValues });
      const checking = { org, modelProviders, providing };
      const given = yield* Effect.fromResult(givenOf(kept.connection, giving, checking));
      const secretId = yield* secrets
        .keep(Redacted.make(given.value), given.endsWith)
        .pipe(Effect.mapError((failure) => unkeptRefusalOf(kept.connection.name, given.pointer, failure)));
      const algorithm = given.algorithm === undefined ? {} : { algorithm: given.algorithm };
      const client = given.clientId === undefined ? {} : { client_id: given.clientId };
      const connected = yield* recordInRegistry({
        type: 'give',
        ...use,
        secret_id: secretId,
        ...algorithm,
        ...client,
      }).pipe(Effect.tapError(() => secrets.forget(secretId)));
      return connectionShown(connected.connection, given.endsWith ?? null);
    }),
  });
}
