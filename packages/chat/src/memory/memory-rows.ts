export type Author = 'person' | 'assistant' | 'context' | 'overheard';

export interface Remembered {
  readonly author: Author;
  readonly sender: string | undefined;
  readonly text: string;
}

export interface RememberedRow extends Remembered {
  readonly sequence: number;
}

export interface MemoryRows {
  readonly newest: (most: number) => Promise<readonly RememberedRow[]>;
  readonly appended: (rows: readonly Remembered[]) => Promise<void>;
}
