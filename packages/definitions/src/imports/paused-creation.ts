import { Caller, randomUUIDv7, recordedCallerOf } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { savedFrom } from '../operations/saved-content.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';

export interface PausedCreation {
  readonly type: string;
  readonly name: string;
  readonly source: string;
  readonly overview?: string;
  readonly diagram?: string;
  readonly reason?: string;
}

export function definitionCreatedPaused(capabilities: readonly Capability[], pages: SubjectPages, goals = false) {
  const known = knownCapabilities(capabilities);
  return Effect.fnUntraced(function* ({ type, name, reason, ...written }: PausedCreation) {
    const capability = yield* known.capabilityOfType(type);
    const createdBy = recordedCallerOf(yield* Caller);
    const definitionId = yield* Effect.sync(randomUUIDv7);
    const { stored } = yield* savedFrom({ capability, pages, written, goals }, (content) => ({
      type: 'create',
      name,
      content,
      created_by: createdBy,
      definition_id: definitionId,
      paused: reason === undefined ? {} : { reason },
    }));
    return stored;
  });
}
