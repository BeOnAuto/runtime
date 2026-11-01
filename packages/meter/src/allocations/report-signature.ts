import { createHmac } from 'node:crypto';

import { sha256Of } from '@on.auto/content';

import { secretOfKey } from '../licensing/license-key.ts';
import type { OfflineReport } from '../meter-stream/allocation-events.ts';

export function reportSignatureOf(
  key: string,
  { allocation, installation, sequence, spent, at }: OfflineReport,
): string {
  const digest = sha256Of(secretOfKey(key));
  return createHmac('sha256', digest).update([allocation, installation, sequence, spent, at].join('.')).digest('hex');
}
