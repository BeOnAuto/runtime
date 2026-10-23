import { textOfContent, textToKeep, type PlaybookAddress, type RecordedContent } from '@on.auto/operations';
import { Effect } from 'effect';

export type ContentStore = Pick<RecordedContent, 'put' | 'get'>;

interface KeptText {
  readonly sha256: string;
  readonly bytes: number;
}

export interface KeptContent {
  readonly keep: (text: string) => Effect.Effect<KeptText>;
  readonly read: (sha256: string) => Effect.Effect<string | undefined>;
}

export function keptIn(store: ContentStore, playbook: PlaybookAddress): KeptContent {
  return {
    keep: (text) =>
      store.put(playbook, textToKeep(text, 'application/json')).pipe(
        Effect.map(({ sha256, bytes }) => ({ sha256, bytes })),
        Effect.orDie,
      ),
    read: (sha256) =>
      Effect.flatMap(store.get(playbook, sha256), (content) =>
        content === undefined ? Effect.undefined : textOfContent(content),
      ),
  };
}
