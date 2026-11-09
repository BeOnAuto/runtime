import { Data } from 'effect';

import type { FailureDetail } from './refusals.ts';

export class StartRejected extends Data.TaggedError('start_rejected')<FailureDetail> {}
