import type { Effect } from 'effect';

import type { Taken } from './content-intake.ts';
import type { AskedRange, ContentPart } from './content-parts.ts';
import type { ContentRefused } from './content-refusals.ts';
import type { ContentToKeep, StreamedContent } from './streamed-content.ts';

export interface ContentOwner {
  readonly org: string;
  readonly playbook: string;
}

export interface Digested {
  readonly sha256: string;
  readonly bytes: number;
}

export interface ContentKept extends Digested {
  readonly mediaType: string;
}

export interface RecordedContent {
  readonly put: (playbook: ContentOwner, content: ContentToKeep) => Effect.Effect<ContentKept, ContentRefused>;
  readonly get: (playbook: ContentOwner, sha256: string) => Effect.Effect<StreamedContent | undefined>;
  readonly getHead: (playbook: ContentOwner, sha256: string) => Effect.Effect<KeptContentHead | undefined>;
  readonly getPart: (
    playbook: ContentOwner,
    sha256: string,
    asked: AskedRange,
  ) => Effect.Effect<ContentPart | undefined>;
}

export type UnheldRemoval = 'removed' | 'held' | 'fresh';

export interface StagedContent {
  readonly taken: Taken;
  readonly placed: (mediaType: string) => Effect.Effect<void>;
  readonly discarded: () => Effect.Effect<void>;
}

export interface ContentStore {
  readonly stage: (playbook: ContentOwner, content: ContentToKeep) => Effect.Effect<StagedContent, ContentRefused>;
  readonly holds: (playbook: ContentOwner, sha256: string) => Effect.Effect<boolean>;
  readonly read: (playbook: ContentOwner, sha256: string) => Effect.Effect<StreamedContent | undefined>;
  readonly readPart: (
    playbook: ContentOwner,
    sha256: string,
    asked: AskedRange,
  ) => Effect.Effect<ContentPart | undefined>;
  readonly delete: (playbook: ContentOwner, sha256: string) => Effect.Effect<void>;
  readonly sweepContent: (before: number) => Promise<void>;
}

export interface ContentHead {
  readonly bytes: number;
  readonly mediaType: string;
}

export interface KeptContentHead extends ContentHead {
  readonly keptAt: number;
}

export type HeadKept =
  | { readonly kept: 'new' | 'standing'; readonly head: ContentHead }
  | { readonly kept: 'removing'; readonly since: number };

export type HeadMarked =
  | { readonly marked: false; readonly answer: UnheldRemoval }
  | { readonly marked: true; readonly since: number };

export interface RemovalTimes {
  readonly before: number;
  readonly now: number;
  readonly staleBefore: number;
}

export interface ContentHeads {
  readonly kept: (playbook: ContentOwner, sha256: string, head: ContentHead, keptAt: number) => Effect.Effect<HeadKept>;
  readonly touched: (playbook: ContentOwner, sha256: string, keptAt: number) => Effect.Effect<HeadKept | undefined>;
  readonly marked: (playbook: ContentOwner, sha256: string, times: RemovalTimes) => Effect.Effect<HeadMarked>;
  readonly cleared: (playbook: ContentOwner, sha256: string, since: number) => Effect.Effect<void>;
  readonly unmarked: (playbook: ContentOwner, sha256: string, since: number) => Effect.Effect<void>;
  readonly read: (playbook: ContentOwner, sha256: string) => Effect.Effect<KeptContentHead | undefined>;
}
