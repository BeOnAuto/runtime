import { Data } from 'effect';

export class StagingEnded extends Data.TaggedError('staging_ended')<{
  readonly detail: string;
  readonly run: string;
}> {}

export function stagingEnded(run: string): StagingEnded {
  return new StagingEnded({ detail: `Nothing more is staged under run ${run}, since what it staged was removed`, run });
}
