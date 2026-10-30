import { Data } from 'effect';

export class SecretKeyUnknown extends Data.TaggedError('secret_key_unknown')<{
  readonly kid: string;
  readonly detail: string;
}> {}

export function secretKeyUnknown(kid: string): SecretKeyUnknown {
  return new SecretKeyUnknown({
    kid,
    detail: `The secret is sealed under the key ${kid}, which is neither the current key nor the previous one`,
  });
}
