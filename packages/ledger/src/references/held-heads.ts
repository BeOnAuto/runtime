import { Data } from 'effect';

export interface HeldHead {
  readonly playbookKey: string;
  readonly sha256: string;
  readonly keptIn: string | undefined;
}

export type HeldHeads = (most: number) => Promise<readonly HeldHead[]>;

export class HeldContentUnchecked extends Data.TaggedError('held_content_unchecked')<{ readonly failure: unknown }> {}
