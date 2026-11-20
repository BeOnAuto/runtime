import { Effect, Result } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { unparseable } from '../operations/definition-preparation.ts';
import { sourceToPrepare } from '../operations/definition-views.ts';
import { refusedToAnswerFor } from '../operations/unread-texts.ts';
import { textRead } from '../payloads/kept-texts.ts';
import type { PlaybookRegistries } from '../used-by/definition-users.ts';
import { namesNoDefinition } from '../used-by/definitions-named.ts';
import {
  declaredUsesOf,
  renameCandidatesIn,
  type RenameCandidate,
  type RenameMember,
  type Renaming,
} from './rename-members.ts';

const memberOf = Effect.fnUntraced(function* (candidate: RenameCandidate, renaming: Renaming) {
  const { type, capability, stored, namedAsStored, callsOrReads } = candidate;
  const source = yield* textRead('source', stored.source).pipe(Effect.mapError(refusedToAnswerFor(type, stored)));
  const prepared = yield* Effect.result(capability.prepare(sourceToPrepare(type, source)));
  if (Result.isFailure(prepared)) {
    return namedAsStored ? yield* Effect.fail(unparseable(type, stored)(prepared.failure)) : [];
  }
  const named = prepared.success.definitionsNamed ?? namesNoDefinition;
  const { declares, awaits } = declaredUsesOf(named, renaming);
  const member: RenameMember = { ...candidate, named, usedByItsRuns: callsOrReads || awaits };
  return namedAsStored || declares ? [member] : [];
});

export const renameMembersOf = Effect.fnUntraced(function* (
  capabilities: readonly Capability[],
  registries: PlaybookRegistries,
  renaming: Renaming,
) {
  const candidates = renameCandidatesIn(capabilities, registries, renaming);
  return (yield* Effect.forEach(candidates, (candidate) => memberOf(candidate, renaming))).flat();
});
