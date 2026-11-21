import { Conflict, type PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { runsInProgressRefused } from '../moving/runs-not-ended.ts';
import { storedTypesByStatus } from '../reading/run-status.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import { retiredToChange } from '../registry/registry-decisions.ts';
import { composedFactsOf } from '../run-work/declared-facts.ts';
import type { RenameMember } from './rename-members.ts';
import {
  runsNotEndedOfAServer,
  runsNotEndedOfAUser,
  runsNotEndedOfTheRenamed,
  tooManyServersWords,
  tooManyUsersWords,
} from './rename-words.ts';

export const mostFactsInARename = 64;

export function startedTypesOf(capabilities: readonly Capability[]): readonly string[] {
  return storedTypesByStatus(composedFactsOf(capabilities).onRuns).started;
}

export function retiredRefused(type: string, stored: RegisteredDefinition): Effect.Effect<void, Conflict> {
  return stored.status === 'retired' ? Effect.fail(retiredToChange(type, stored.name)) : Effect.void;
}

export function runsInProgressOfMembers(
  started: readonly string[],
  renamed: RenameMember,
  members: readonly RenameMember[],
): Effect.Effect<void, Conflict, PlaybookReader> {
  const users = members.filter((member) => member !== renamed && member.usedByItsRuns);
  return Effect.andThen(
    runsInProgressRefused(started, [renamed], runsNotEndedOfTheRenamed),
    runsInProgressRefused(started, users, runsNotEndedOfAUser(renamed.name)),
  );
}

export function boundRefused(renamed: RenameMember, saved: readonly RenameMember[]): Effect.Effect<void, Conflict> {
  const others = saved.filter((member) => member !== renamed).length;
  const most = mostFactsInARename - 1 - (saved.length - others);
  return others > most ? Effect.fail(new Conflict({ detail: tooManyUsersWords(renamed, others, most) })) : Effect.void;
}

interface Server {
  readonly type: string;
  readonly name: string;
}

export function goalRenameRefused(
  started: readonly string[],
  servers: readonly Server[],
  goal: string,
): Effect.Effect<void, Conflict, PlaybookReader> {
  const most = mostFactsInARename - 1;
  return Effect.andThen(
    runsInProgressRefused(started, servers, runsNotEndedOfAServer(goal)),
    servers.length > most
      ? Effect.fail(new Conflict({ detail: tooManyServersWords(goal, servers.length, most) }))
      : Effect.void,
  );
}
