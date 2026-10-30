import { Data } from 'effect';

export class CredentialsRejected extends Data.TaggedError('credentials_rejected')<{
  readonly detail: string;
  readonly provider: string;
  readonly status: number | null;
}> {}
