import { Data } from 'effect';

export type RefusedBecause = 'pointer_disagrees';

export class ReadModelRefused extends Data.TaggedError('read_model_refused')<{ readonly because: RefusedBecause }> {}
