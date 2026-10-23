import { uuidV7Before } from '@on.auto/operations';

import type { Bucket } from '../bucket/bucket.ts';

function startedBefore(key: string, before: number): boolean {
  return uuidV7Before(key.slice(key.lastIndexOf('/') + 1), before);
}

async function staleObjectsUnder(bucket: Bucket, uploads: string, before: number): Promise<readonly string[]> {
  const stale: string[] = [];
  for await (const key of bucket.list(uploads)) {
    if (!startedBefore(key, before)) {
      break;
    }
    stale.push(key);
  }
  return stale;
}

export async function sweptUploads(bucket: Bucket, uploads: string, before: number): Promise<void> {
  await bucket.delete(await staleObjectsUnder(bucket, uploads, before));
  for await (const unfinished of bucket.unfinished(uploads)) {
    if (startedBefore(unfinished.key, before)) {
      await unfinished.abandon();
    }
  }
}
