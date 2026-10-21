import { Data } from 'effect';

export type SecretRefusedBecause = 'empty' | 'too_large' | 'refused_by_the_keeper' | 'over_the_keepers_quota';

export class SecretRefused extends Data.TaggedError('secret_refused')<{
  readonly because: SecretRefusedBecause;
  readonly detail: string;
}> {}
