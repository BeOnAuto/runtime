import { Data } from 'effect';

export class PayloadErased extends Data.TaggedError('payload_erased')<{
  readonly org: string;
  readonly playbook: string;
  readonly sha256: string;
  readonly message: string;
}> {}
