import { textOfContent, textToKeep, type RecordedContent } from '@on.auto/content';
import type { Context, Lineage, PlaybookAddress } from '@on.auto/operations';
import type { ImageCall } from '@on.auto/tool-servers';
import { Effect } from 'effect';

export type ContentStore = Pick<RecordedContent, 'put' | 'get'>;

export interface RunImage {
  readonly playbook: PlaybookAddress;
  readonly bytes: Readonly<Uint8Array>;
  readonly call: ImageCall;
  readonly context: Omit<Context, 'at'>;
  readonly lineage: Lineage;
}

export type KeepRunImage = (image: RunImage) => Effect.Effect<string | undefined>;

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
