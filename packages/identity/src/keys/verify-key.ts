import { timingSafeEqual } from 'node:crypto';

import { sha256Of } from '@on.auto/operations';

import type { ApiKeySource } from './api-key-source.ts';
import { keyIdOf, keyPrefix, type ApiKey } from './api-key.ts';

const digestOfNoKey = sha256Of(keyPrefix);

function sameDigest(presented: string, stored: string): boolean {
  return timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(stored, 'hex'));
}

export async function verifyKey(source: ApiKeySource, presented: string): Promise<ApiKey | undefined> {
  const id = keyIdOf(presented);
  const candidate = id === undefined ? undefined : await source.keyOf(id);
  return sameDigest(sha256Of(presented), candidate?.sha256 ?? digestOfNoKey) ? candidate : undefined;
}
