import type { MeteredRun } from '@on.auto/definitions';
import type { Conflict, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { isGoalNotice } from '../admission/goal-notice.ts';
import type { Licensing } from './licensing.ts';
import { admittedSelfHosted } from './self-hosted-admission.ts';

export function admittedSelfHostedFreeingNotices(
  licensing: Licensing,
  run: MeteredRun,
): Effect.Effect<void, Conflict | Unavailable> {
  return isGoalNotice(run) ? Effect.void : admittedSelfHosted(licensing, run);
}
