import { leftUnread, textOfContent, type StreamedContent } from '@on.auto/content';
import { Effect, JsonPointer, Predicate } from 'effect';

import type { ContentHolders } from '../held-content/content-declaration.ts';
import { PlaybookReader } from '../ledger/playbook-reader.ts';
import type { KeptContent } from './presenter.ts';
import type { RecordedFact } from './recorded-read.ts';

const digestEnding = '_sha256';

function payloadMembersOf(holders: ContentHolders, type: string): ReadonlySet<string> {
  const pointers = holders.get(type)?.payloads ?? [];
  return new Set(pointers.map(({ sha256 }) => JsonPointer.unescapeToken(sha256.slice(1))));
}

function digestsKeptIn({ type, data }: RecordedFact, mostBytes: number, holders: ContentHolders): readonly string[] {
  if (!Predicate.isObject(data)) {
    return [];
  }
  const payloads = payloadMembersOf(holders, type);
  const digests: string[] = [];
  for (const [key, digest] of Object.entries(data)) {
    const bytes: unknown = Reflect.get(data, `${key.slice(0, -digestEnding.length)}_bytes`);
    const isContent = key.endsWith(digestEnding) && !payloads.has(key);
    if (isContent && typeof digest === 'string' && typeof bytes === 'number' && bytes <= mostBytes) {
      digests.push(digest);
    }
  }
  return digests;
}

function isText({ mediaType }: StreamedContent): boolean {
  const type = mediaType.replace(/;.*$/su, '').trim().toLowerCase();
  return type.startsWith('text/') || type === 'application/json' || type.endsWith('+json');
}

export const nothingKept: KeptContent = (sha256) => new Map<string, string>().get(sha256);

export function keptContentOf(
  records: readonly RecordedFact[],
  mostBytes: number,
  holders: ContentHolders,
): Effect.Effect<KeptContent, never, PlaybookReader> {
  const digests = [...new Set(records.flatMap((record) => digestsKeptIn(record, mostBytes, holders)))];
  return Effect.gen(function* () {
    const reader = yield* PlaybookReader;
    const kept = new Map<string, string>();
    for (const digest of digests) {
      const content = yield* reader.readContent(digest);
      if (content !== undefined && isText(content)) {
        kept.set(digest, yield* textOfContent(content));
      } else if (content !== undefined) {
        yield* leftUnread(content.stream);
      }
    }
    return (sha256: string) => kept.get(sha256);
  });
}
