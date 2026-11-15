import { uuidV7Before } from '@on.auto/operations';

import type { Bucket } from '../bucket/bucket.ts';

const keysInAPage = 1000;

function startedBefore(key: string, before: number): boolean {
  return uuidV7Before(key.slice(key.lastIndexOf('/') + 1), before);
}

async function* stalePagesUnder(bucket: Bucket, uploads: string, before: number): AsyncGenerator<readonly string[]> {
  let page: string[] = [];
  for await (const key of bucket.list(uploads)) {
    if (!startedBefore(key, before)) {
      break;
    }
    page.push(key);
    if (page.length === keysInAPage) {
      yield page;
      page = [];
    }
  }
  if (page.length > 0) {
    yield page;
  }
}

export async function sweptUploads(bucket: Bucket, uploads: string, before: number): Promise<void> {
  for await (const page of stalePagesUnder(bucket, uploads, before)) {
    await bucket.delete(page);
  }
  for await (const unfinished of bucket.unfinished(uploads)) {
    if (startedBefore(unfinished.key, before)) {
      await unfinished.abandon();
    }
  }
}
