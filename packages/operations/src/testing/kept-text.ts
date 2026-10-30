import { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import type { RecordedContent } from '../content/recorded-content.ts';
import { textOfContent } from '../content/streamed-content.ts';

export function keptTextOf(
  content: Pick<RecordedContent, 'get'>,
  playbook: PlaybookAddress,
  sha256: string,
): Promise<string | undefined> {
  return Effect.runPromise(
    Effect.flatMap(content.get(playbook, sha256), (kept) =>
      kept === undefined ? Effect.succeed(kept) : textOfContent(kept),
    ),
  );
}
