import type { ContentKept, ContentRefused, ContentToKeep } from '@on.auto/content';
import { Context, Effect } from 'effect';

import { PlaybookContext } from '../caller/playbook-context.ts';
import type { Unavailable } from '../outcome/unavailable.ts';
import { payloadKept } from '../payloads/payload-keeping.ts';
import type { PayloadToKeep } from '../payloads/payload-texts.ts';
import type { StreamWriter } from './stream-ports.ts';

export interface PlaybookContentWriter {
  readonly keepContent: (content: ContentToKeep) => Effect.Effect<ContentKept, ContentRefused>;
}

export class PlaybookWriter extends Context.Service<PlaybookWriter, StreamWriter & PlaybookContentWriter>()(
  '@on.auto/operations/PlaybookWriter',
) {}

export function playbookPayloadKept(
  toKeep: PayloadToKeep,
): Effect.Effect<void, Unavailable, PlaybookWriter | PlaybookContext> {
  return Effect.gen(function* () {
    const { org, playbook } = yield* PlaybookContext;
    const { keepContent } = yield* PlaybookWriter;
    return yield* payloadKept({ put: (_owner, content) => keepContent(content) }, { org, playbook }, toKeep);
  });
}
