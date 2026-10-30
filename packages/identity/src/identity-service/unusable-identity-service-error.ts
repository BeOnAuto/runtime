import { Data } from 'effect';

export class UnusableIdentityServiceError extends Data.TaggedError('UnusableIdentityServiceError')<{
  readonly message: string;
}> {}
