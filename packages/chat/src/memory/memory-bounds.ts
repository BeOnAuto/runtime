import { mostListingBytes } from '@on.auto/api';

import { TURN_BOUNDS } from '../turn/turn-bounds.ts';
import { BYTES_A_TOKEN } from '../turn/turn-input.ts';

export const MOST_REMEMBERED_ROWS = 100;

export const MOST_THREAD_MESSAGES = 15;

export const INSTRUCTIONS_ALLOWANCE_BYTES = 16 * 1024;

export interface BudgetParts {
  readonly requestInputTokens: number;
  readonly listingBytes: number;
  readonly instructionsBytes: number;
}

export const conversationBytesWithin = ({ requestInputTokens, listingBytes, instructionsBytes }: BudgetParts): number =>
  requestInputTokens * BYTES_A_TOKEN - listingBytes - instructionsBytes;

export const MOST_CONVERSATION_BYTES = conversationBytesWithin({
  requestInputTokens: TURN_BOUNDS.requestInputTokens,
  listingBytes: mostListingBytes.directory,
  instructionsBytes: INSTRUCTIONS_ALLOWANCE_BYTES,
});

export interface MemoryBounds {
  readonly rows: number;
  readonly threadMessages: number;
  readonly conversationBytes: number;
}

export const MEMORY_BOUNDS: MemoryBounds = {
  rows: MOST_REMEMBERED_ROWS,
  threadMessages: MOST_THREAD_MESSAGES,
  conversationBytes: MOST_CONVERSATION_BYTES,
};
