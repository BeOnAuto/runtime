import { Effect, Schema } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';
import { recordChangeInRegistry } from '../operations/registry-access.ts';
import type { SigningSecretRemoval, SigningSecretSetting } from '../registry/connection-commands.ts';
import { ConnectionSchema } from '../registry/connection.ts';
import { signingSecretsReleasedOf } from '../registry/kept-signing.ts';

type SigningChange = SigningSecretSetting | SigningSecretRemoval;

export const ConnectionSigningSchema = Schema.Struct({
  id: ConnectionSchema.fields.id,
  signing_secret: ConnectionSchema.fields.signing_secret,
}).annotate({
  identifier: 'ConnectionSigningSecret',
  description: 'Whether a connection holds a signing secret, and since when, never the secret',
});

export const signingChanged = Effect.fnUntraced(function* (
  secrets: Pick<SecretKeeping, 'forget'>,
  change: SigningChange,
) {
  const { before, after } = yield* recordChangeInRegistry(change).pipe(
    Effect.catchTags({ forbidden: Effect.die, invalid_input: Effect.die }),
  );
  yield* Effect.forEach(signingSecretsReleasedOf(before.signing, after.signing), (id) => secrets.forget(id), {
    discard: true,
  });
  const { id, signing_secret: signingSecret } = after.connection;
  return { id, signing_secret: signingSecret };
});
