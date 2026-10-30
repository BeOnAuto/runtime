import type { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import type { ContentRefused } from './content-refusals.ts';
import type { ContentToKeep, StreamedContent } from './streamed-content.ts';

export interface Digested {
  readonly sha256: string;
  readonly bytes: number;
}

export interface ContentKept extends Digested {
  readonly mediaType: string;
}

export interface RecordedContent {
  readonly put: (playbook: PlaybookAddress, content: ContentToKeep) => Effect.Effect<ContentKept, ContentRefused>;
  readonly get: (playbook: PlaybookAddress, sha256: string) => Effect.Effect<StreamedContent | undefined>;
}

export interface ContentStore {
  readonly content: RecordedContent;
  readonly sweepContent: (before: number) => Promise<void>;
}

export interface PlaybookContentReader {
  readonly readContent: (sha256: string) => Effect.Effect<StreamedContent | undefined>;
}
