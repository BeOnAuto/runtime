import { Data } from 'effect';

export class ReachableWithoutCredentialsError extends Data.TaggedError('ReachableWithoutCredentialsError')<{
  readonly message: string;
}> {}
