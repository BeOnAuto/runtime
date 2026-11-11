import { Caller, defineHttpOperation, type Forbidden } from '@on.auto/operations';
import { Effect, Redacted, Schema } from 'effect';

import { ConnectionIdField } from '../operations/connection-fields.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { foundConnection } from '../operations/registry-access.ts';
import { signerRefusalOf } from '../policy/policy-rules.ts';
import { previousSigningSecretLastsHours } from '../registry/signing-decisions.ts';
import { SecretField, secretToKeep, unkeptOf } from './given-signing-secrets.ts';
import { ConnectionSigningSchema, signingChanged } from './signing-changes.ts';

const SetSigningSecretSchema = Schema.Struct({
  ...ConnectionSigningSchema.fields,
  secret: Schema.optionalKey(
    Schema.String.annotate({ description: 'The signing secret the runtime made, answered this once and never again' }),
  ),
}).annotate({
  identifier: 'SigningSecretSet',
  description: 'The signing secret a connection now holds, and the secret itself where the runtime made it',
});

function refusedSigner(access: ConnectionServices['access']): Effect.Effect<void, Forbidden, Caller> {
  return Effect.flatMap(Effect.service(Caller), (caller) => {
    const refusal = signerRefusalOf(access, caller);
    return refusal === undefined ? Effect.void : Effect.fail(refusal);
  });
}

export function defineSetConnectionSigningSecret({ secrets, access }: Pick<ConnectionServices, 'secrets' | 'access'>) {
  return defineHttpOperation('org', 'command', {
    name: 'set_connection_signing_secret',
    title: 'Set connection signing secret',
    description: [
      "Sets the secret a connection's service signs what it sends with, as the Standard Webhooks specification signs a webhook, so the service may answer a request sent through it.",
      'Given secret, the one the service made, it keeps that; left out, it makes one of 32 random bytes and answers it this once, and never again.',
      'The runtime keeps the secret sealed in its secret store, and no other answer, record or history of the org ever holds it.',
      `A secret set while the connection holds one replaces it, and the one replaced verifies too for ${previousSigningSecretLastsHours} hours, so the service changes over with no gap.`,
      'Only a person sets it, in Studio, never a key or an agent; a removed connection is refused as conflict.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/signing-secret' },
    body: { kind: 'json' },
    inputSchema: Schema.Struct({ id: ConnectionIdField, secret: Schema.optionalKey(SecretField) }),
    outputSchema: SetSigningSecretSchema,
    reasons: ['not_found', 'forbidden', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id, secret }) {
      yield* refusedSigner(access);
      const { connection } = yield* foundConnection(id);
      const value = yield* secretToKeep(secret);
      const secretId = yield* secrets
        .keep(value)
        .pipe(Effect.mapError((failure) => unkeptOf(connection.name, failure)));
      const change = { type: 'set_signing_secret', connection: id, secret_id: secretId } as const;
      const shown = yield* signingChanged(secrets, change).pipe(Effect.onError(() => secrets.forget(secretId)));
      return secret === undefined ? { ...shown, secret: Redacted.value(value) } : shown;
    }),
  });
}
