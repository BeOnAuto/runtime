import type { JournalRefusal, RunContext } from '@on.auto/definitions';
import { Unavailable } from '@on.auto/operations';
import type { NotOfferedBecause, RunTools, ServerFailedBecause, ToolAccess } from '@on.auto/tool-servers';
import { runIdKey, type ToolReference } from '@on.auto/tool-servers/policy';
import { Effect } from 'effect';

import type { BeforeTheSteps } from '../capability/before-the-steps.ts';
import { unfinishedAfter } from './tool-endings.ts';

interface Refused<Because> {
  readonly because: Because;
  readonly detail: string;
}

interface Refusal {
  readonly detail: string;
  readonly kind: 'tool_not_offered' | 'tool_server_failed';
  readonly because: NotOfferedBecause | ServerFailedBecause;
}

function refusedAfter(
  { use, spent, ended }: BeforeTheSteps,
  refusal: Refusal,
): Effect.Effect<never, Unavailable | JournalRefusal> {
  return Effect.andThen(
    ended,
    use.calledAny
      ? unfinishedAfter(use, 'server_failed', refusal.detail, spent)
      : Effect.fail(new Unavailable({ ...refusal, ...spent })),
  );
}

function opened(
  access: ToolAccess,
  references: readonly ToolReference[],
  { id, org, playbook, journal }: RunContext,
  before: BeforeTheSteps,
): Effect.Effect<RunTools, Unavailable | JournalRefusal> {
  return access.open({ id, org, playbook, journal, meta: { [runIdKey]: id } }, references).pipe(
    Effect.catchTags({
      tool_not_offered: ({ because, detail }: Refused<NotOfferedBecause>) =>
        refusedAfter(before, { detail, kind: 'tool_not_offered', because }),
      tool_server_failed: ({ because, detail }: Refused<ServerFailedBecause>) =>
        refusedAfter(before, { detail, kind: 'tool_server_failed', because }),
    }),
  );
}

export interface Opening {
  readonly access: ToolAccess;
  readonly references: readonly ToolReference[];
  readonly run: RunContext;
  readonly before: BeforeTheSteps;
}

export function withTools<A, E>(
  { access, references, run, before }: Opening,
  use: (tools?: RunTools) => Effect.Effect<A, E>,
): Effect.Effect<A, E | Unavailable | JournalRefusal> {
  if (references.length === 0) {
    return use();
  }
  return opened(access, references, run, before).pipe(
    Effect.flatMap((tools) => use(tools).pipe(Effect.ensuring(Effect.promise(() => tools.close())))),
  );
}
