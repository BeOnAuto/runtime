import type { UnheldRemoval } from '@on.auto/content';
import type { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';

export const keptContentGraceMs = 3_600_000;

export interface UnheldContentRemover {
  readonly removeUnheld: (playbook: PlaybookAddress, sha256: string) => Effect.Effect<UnheldRemoval>;
}

export function noHoldersKnown(): Error {
  return new Error(
    'The ledger was opened without the facts that hold content, so it cannot tell a held content from an unheld one and removes none',
  );
}
