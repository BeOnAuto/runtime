import type { Effect } from 'effect';

import type { ContentOwner, ContentStore, ExpiredErased, RecordedContent } from '../content/recorded-content.ts';

export interface ContentStoreUnderTest {
  readonly content: RecordedContent;
  readonly elsewhere: RecordedContent;
  readonly unnamedLeft: () => Promise<number>;
}

export interface ContentEntry {
  readonly aStore: () => Promise<ContentStoreUnderTest>;
}

export interface ErasingContent {
  readonly content: RecordedContent;
  readonly eraseExpired: (most: number) => Effect.Effect<ExpiredErased>;
}

export interface ErasingContentTwice extends ErasingContent {
  readonly elsewhere: ErasingContent;
}

export interface ExpiringStoreUnderTest extends ErasingContentTwice {
  readonly bytesHeld: (playbook: ContentOwner, sha256: string) => Promise<boolean>;
}

export interface ExpiringContentEntry {
  readonly aStore: () => Promise<ExpiringStoreUnderTest>;
}

export interface InterleavedErasureEntry {
  readonly aStore: () => Promise<ContentStore>;
  readonly aKeeping: (store: ContentStore) => Promise<ErasingContentTwice>;
}
