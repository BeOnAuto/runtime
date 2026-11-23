import type { Effect } from 'effect';

import { OrgReader } from '../ledger/org-reader.ts';
import { PlaybookReader } from '../ledger/playbook-reader.ts';

export function playbookReadsTogether<A, E, R>(reads: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | PlaybookReader> {
  return PlaybookReader.use((reader) => reader.readTogether(reads));
}

export function orgReadsTogether<A, E, R>(reads: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | OrgReader> {
  return OrgReader.use((reader) => reader.readTogether(reads));
}
