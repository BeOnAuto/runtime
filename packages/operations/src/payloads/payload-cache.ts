import type { ContentOwner } from '@on.auto/content';
import { Function } from 'effect';

export interface PayloadCache {
  readonly textOf: (owner: ContentOwner, sha256: string) => string | undefined;
  readonly kept: (owner: ContentOwner, sha256: string, text: string) => void;
}

interface CachedText {
  readonly text: string;
  readonly bytes: number;
}

const bytesACodeUnit = 2;

function keyOf({ org, playbook }: ContentOwner, sha256: string): string {
  return JSON.stringify([org, playbook, sha256]);
}

export const noPayloadCache: PayloadCache = {
  textOf: Function.constUndefined,
  kept: Function.constVoid,
};

export function payloadCacheWithin(mostBytes: number): PayloadCache {
  const texts = new Map<string, CachedText>();
  let held = 0;
  const evictedDownTo = (most: number) => {
    for (const [key, { bytes }] of texts) {
      if (held <= most) {
        return;
      }
      texts.delete(key);
      held -= bytes;
    }
  };
  const readAgain = (key: string) => {
    const cached = texts.get(key);
    if (cached !== undefined) {
      texts.delete(key);
      texts.set(key, cached);
    }
    return cached;
  };
  return {
    textOf: (owner, sha256) => readAgain(keyOf(owner, sha256))?.text,
    kept: (owner, sha256, text) => {
      const key = keyOf(owner, sha256);
      const bytes = text.length * bytesACodeUnit;
      if (bytes > mostBytes || readAgain(key) !== undefined) {
        return;
      }
      texts.set(key, { text, bytes });
      held += bytes;
      evictedDownTo(mostBytes);
    },
  };
}
