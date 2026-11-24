import { defineHttpOperation, OrgContext } from '@on.auto/operations';
import { Effect } from 'effect';

import { tokenSha256Of } from '../links/link-token.ts';
import {
  allowedToChoose,
  loadRegistry,
  recordChangeInRegistry,
  recordedCaller,
} from '../operations/registry-access.ts';
import { connectionShown } from '../registry/connection.ts';
import { linkedConnectionOf } from '../registry/registry-lookup.ts';
import { GivenConnectionSchema, GivingSchema } from './given-fields.ts';
import { givenValuesKept } from './given-values.ts';
import { modelAtConnect } from './models-at-connect.ts';
import { replacedWayOf } from './replaced-ways.ts';

type GivingServices = Parameters<typeof givenValuesKept>[2] &
  Parameters<typeof replacedWayOf>[2] &
  Parameters<typeof modelAtConnect>[2];

const givenThrough = Effect.fnUntraced(function* (
  { playbooks, model, ...giving }: typeof GivingSchema.Type,
  services: GivingServices,
) {
  const { secrets } = services;
  yield* allowedToChoose(playbooks);
  const use = { connection: giving.id, token_sha256: tokenSha256Of(giving.token) };
  const kept = yield* Effect.fromResult(linkedConnectionOf(yield* loadRegistry(services), use));
  const atConnect = yield* modelAtConnect(kept, { model, appsGiven: giving.app_credentials ?? {} }, services);
  const values = yield* givenValuesKept(kept.connection, giving, services);
  const { given, secretId, appSecretIds } = values;
  const { before, after } = yield* recordChangeInRegistry(services, {
    type: 'give',
    ...use,
    connected_by: yield* recordedCaller,
    secret_id: secretId,
    ...(given.algorithm === undefined ? {} : { algorithm: given.algorithm }),
    ...(given.clientId === undefined ? {} : { client_id: given.clientId }),
    app_secret_ids: appSecretIds,
    ...(playbooks === undefined ? {} : { playbooks }),
    ...atConnect.choice,
  }).pipe(Effect.onError(() => Effect.forEach(values.kept, secrets.forget)));
  yield* replacedWayOf(before, after, services);
  return {
    ...connectionShown(after.connection, given.endsWith ?? null),
    ...values.formatMark,
    ...atConnect.answerOf(after),
  };
});

export function defineGiveCredential(services: GivingServices) {
  return defineHttpOperation('org', 'command', {
    name: 'give_credential',
    title: 'Give credential',
    description: [
      'Gives the credential of a connection through its open link, which approves the connection and uses the link up, and answers it connected.',
      "A secret of another format than its provider's pattern is refused, and one that misses the pattern of a credential given by hand is kept and answered with pattern_unmatched.",
      'The runtime keeps the value sealed in its secret store, and no answer, record or history of the org ever holds it.',
      'Where the secret store cannot keep it just now, it answers unavailable in the words of the store, keeps nothing and leaves the link open, so the same credential is given again.',
      'Before it keeps anything, the runtime checks with the service each app credential given and, where the provider has a check for its key, the key: a value the service refuses is refused as invalid_input at its field, and where the check cannot be completed, as when the service cannot be reached or answers an error, it answers unavailable, keeps nothing and leaves the link open.',
      "For client credentials, the runtime first asks the service for a token with them. If the service refuses them, it answers invalid_input with the service's error code and, where the service gives one, its description; if the service cannot be reached, it answers unavailable. Either way it keeps nothing and leaves the link open, so the right credentials can be given again.",
      'It takes the app credentials list_providers lists for the way in app_credentials, each optional, and refuses one it does not list here.',
      'On a runtime that signs people in, only an admin of the organization may give it.',
      'Given playbooks, a list of playbook ids or null for every playbook of the org, it sets which playbooks may use the connection in the same record as the approval; left out, the connection keeps the playbooks it has. A caller that may access only some playbooks of the org is refused as forbidden when it gives playbooks.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/credential' },
    body: { kind: 'json' },
    inputSchema: GivingSchema,
    outputSchema: GivenConnectionSchema,
    connectionsManagement: true,
    reasons: ['not_found', 'forbidden', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* (giving) {
      const { org } = yield* OrgContext;
      return yield* givenThrough(giving, services).pipe(Effect.annotateLogs({ org, connection: giving.id }));
    }),
  });
}
