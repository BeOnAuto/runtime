import type { RecordedContent } from '../content/recorded-content.ts';

export interface ContentStoreUnderTest {
  readonly content: RecordedContent;
  readonly elsewhere: RecordedContent;
  readonly unnamedLeft: () => Promise<number>;
}

export interface ContentEntry {
  readonly aStore: () => Promise<ContentStoreUnderTest>;
}
