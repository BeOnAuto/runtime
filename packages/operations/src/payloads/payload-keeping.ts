import { textToKeep, type ContentOwner, type ContentRefused, type RecordedContent } from '@on.auto/content';
import { Effect } from 'effect';

import type { Unavailable } from '../outcome/unavailable.ts';
import { noPayloadCache, type PayloadCache } from './payload-cache.ts';
import { noPayloadGate, type PayloadGate } from './payload-gate.ts';
import type { PayloadToKeep } from './payload-texts.ts';
import { unreachable, waitedFor } from './payload-waits.ts';

const notKeptNow = 'A large value could not be kept just now; try again in a moment';

interface KeptWith {
  readonly cache?: PayloadCache;
  readonly gate?: PayloadGate;
}

export function payloadKept(
  content: Pick<RecordedContent, 'put'>,
  owner: ContentOwner,
  { sha256, bytes, text, mediaType }: PayloadToKeep,
  { cache = noPayloadCache, gate = noPayloadGate }: KeptWith = {},
): Effect.Effect<void, Unavailable> {
  const put = content.put(owner, { ...textToKeep(text, mediaType), expected: { sha256, bytes } }).pipe(
    Effect.catchDefect((defect) => unreachable(notKeptNow, sha256, defect)),
    Effect.catchTag(
      'content_refused',
      (refused: Pick<ContentRefused, 'because' | 'detail'>): Effect.Effect<never, Unavailable> =>
        refused.because === 'unavailable' ? unreachable(notKeptNow, sha256, refused) : Effect.die(refused),
    ),
  );
  return gate.through(waitedFor(put, bytes, { detail: notKeptNow, sha256 }), notKeptNow).pipe(
    Effect.andThen(() =>
      Effect.sync(() => {
        cache.kept(owner, sha256, text);
      }),
    ),
  );
}
