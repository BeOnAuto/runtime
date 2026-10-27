import { createHash, createHmac } from 'node:crypto';

import { secretOfKey } from '../licensing/license-key.ts';
import type { OfflineReport } from '../meter-stream/allocation-events.ts';

export function reportSignatureOf(
  key: string,
  { allocation, installation, sequence, spent, at }: OfflineReport,
): string {
  const digest = createHash('sha256').update(secretOfKey(key)).digest('hex');
  return createHmac('sha256', digest).update([allocation, installation, sequence, spent, at].join('.')).digest('hex');
}
