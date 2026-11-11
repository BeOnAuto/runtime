import { madeSigningSecret, signingKeyOf } from '@on.auto/identity';
import { InvalidInput, Unavailable } from '@on.auto/operations';
import type { SecretKeepingFailure } from '@on.auto/tool-servers';
import { Effect, Redacted, Schema } from 'effect';

export const SecretField = Schema.String.annotate({
  description:
    'The signing secret the service made, whsec_ and the base64 of 24 to 64 random bytes, as the Standard Webhooks specification writes one; left out, the runtime makes one',
});

const notASigningSecret = new InvalidInput({
  detail: 'The signing secret cannot be taken as it is given',
  issues: [
    {
      pointer: '/secret',
      detail:
        'Expected a signing secret as the Standard Webhooks specification writes one: whsec_ and the base64 of 24 to 64 random bytes',
    },
  ],
});

export function secretToKeep(given: string | undefined): Effect.Effect<Redacted.Redacted, InvalidInput> {
  if (given === undefined) {
    return Effect.sync(madeSigningSecret);
  }
  return signingKeyOf(given) === undefined ? Effect.fail(notASigningSecret) : Effect.succeed(Redacted.make(given));
}

export function unkeptOf(name: string, { _tag, detail }: SecretKeepingFailure): InvalidInput | Unavailable {
  return _tag === 'secret_refused'
    ? new InvalidInput({
        detail: 'The signing secret cannot be taken as it is given',
        issues: [{ pointer: '/secret', detail }],
      })
    : new Unavailable({
        detail: `The signing secret of the connection ${name} cannot be kept now, so it is not set: ${detail}`,
      });
}
