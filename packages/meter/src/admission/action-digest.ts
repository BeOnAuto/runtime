import { createHash } from 'node:crypto';

import type { MeteredRun } from '@on.auto/definitions';

import { actionOf } from './metering.ts';

export function actionDigestOf(run: MeteredRun): string {
  return createHash('sha256').update(actionOf(run), 'utf8').digest('hex');
}
