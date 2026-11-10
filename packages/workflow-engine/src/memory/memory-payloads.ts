import { sha256Of } from '@on.auto/content';
import { textBytesOf, type PayloadToKeep } from '@on.auto/operations/payloads';
import { Effect } from 'effect';

import type { HeldContent } from '../machine/held-contents.ts';
import { ContentUnavailable } from '../run-log/content-unavailable.ts';
import type { RunPayloads } from '../run-log/run-payloads.ts';

type LostAs = Exclude<HeldContent['kind'], 'read'>;

type PayloadCall = 'read' | 'keep';

export interface MemoryPayloads extends RunPayloads<ContentUnavailable> {
  readonly texts: () => ReadonlyMap<string, string>;
  readonly reads: () => readonly (readonly string[])[];
  readonly keeps: () => readonly (readonly string[])[];
  readonly failNext: (call: PayloadCall) => void;
  readonly lose: (sha256: string, as: LostAs) => void;
  readonly switchTo: (keepsPayloadsOutside: boolean) => void;
}

function unavailable(call: PayloadCall): ContentUnavailable {
  return new ContentUnavailable({ detail: `The store of payloads was told to fail its next ${call}` });
}

function requireItsDigest({ sha256, bytes, text }: PayloadToKeep): void {
  if (sha256Of(text) !== sha256 || textBytesOf(text) !== bytes) {
    throw new RangeError(`A payload kept under ${sha256} of ${bytes} bytes holds a text of another digest or size`);
  }
}

interface KeptTexts {
  readonly texts: ReadonlyMap<string, string>;
  readonly lost: ReadonlyMap<string, LostAs>;
}

function contentIn({ texts, lost }: KeptTexts, sha256: string): HeldContent {
  const as = lost.get(sha256);
  if (as !== undefined) {
    return { kind: as };
  }
  const text = texts.get(sha256);
  return text === undefined ? { kind: 'missing' } : { kind: 'read', text };
}

export function memoryPayloads(keepsPayloadsOutside = false): MemoryPayloads {
  const switched = { keepsPayloadsOutside };
  const texts = new Map<string, string>();
  const lost = new Map<string, LostAs>();
  const kept: KeptTexts = { texts, lost };
  const failing = new Set<PayloadCall>();
  const reads: (readonly string[])[] = [];
  const keeps: (readonly string[])[] = [];
  return {
    get keepsPayloadsOutside() {
      return switched.keepsPayloadsOutside;
    },
    read: (_runId, asked) =>
      Effect.suspend(() => {
        if (failing.delete('read')) {
          return Effect.fail(unavailable('read'));
        }
        reads.push(asked.map(({ sha256 }) => sha256));
        return Effect.succeed(new Map(asked.map(({ sha256 }) => [sha256, contentIn(kept, sha256)])));
      }),
    keep: (_runId, payloads) =>
      Effect.suspend(() => {
        if (failing.delete('keep')) {
          return Effect.fail(unavailable('keep'));
        }
        keeps.push(payloads.map(({ sha256 }) => sha256));
        for (const payload of payloads) {
          requireItsDigest(payload);
          texts.set(payload.sha256, payload.text);
        }
        return Effect.void;
      }),
    texts: () => texts,
    reads: () => reads,
    keeps: () => keeps,
    failNext: (call) => {
      failing.add(call);
    },
    lose: (sha256, as) => {
      lost.set(sha256, as);
    },
    switchTo: (keeping) => {
      switched.keepsPayloadsOutside = keeping;
    },
  };
}
