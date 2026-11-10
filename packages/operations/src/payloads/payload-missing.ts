import { Data } from 'effect';

export type PayloadMissingBecause = 'not_held' | 'not_its_bytes' | 'not_its_kind';

export class PayloadMissing extends Data.TaggedError('payload_missing')<{
  readonly org: string;
  readonly playbook: string;
  readonly sha256: string;
  readonly because: PayloadMissingBecause;
  readonly message: string;
}> {}
