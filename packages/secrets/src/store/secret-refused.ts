import { Data } from 'effect';

export type SecretRefusedBecause = 'empty' | 'too_large';

export class SecretRefused extends Data.TaggedError('secret_refused')<{
  readonly because: SecretRefusedBecause;
  readonly detail: string;
}> {}
