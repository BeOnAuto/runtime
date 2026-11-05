import type { JournalRefusal, RunContext } from '@on.auto/definitions';
import { Unavailable } from '@on.auto/operations';
import type {
  CallerContext,
  NotOfferedBecause,
  RunTools,
  ServerFailedBecause,
  ToolAccess,
} from '@on.auto/tool-servers';
import { runIdKey, type ToolReference } from '@on.auto/tool-servers/policy';
import { Effect } from 'effect';

import type { BeforeTheSteps } from '../capability/before-the-steps.ts';
import type { KeepRunImage } from '../steps/kept-content.ts';
import { unfinishedAfter } from './tool-endings.ts';
import { imagesKeptOn } from './tool-images.ts';

export interface Opening {
  readonly access: ToolAccess;
  readonly references: readonly ToolReference[];
  readonly run: RunContext;
  readonly before: BeforeTheSteps;
  readonly images?: KeepRunImage | undefined;
}

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

function callerOf(run: RunContext, images: KeepRunImage | undefined): CallerContext {
  const { id, org, playbook, journal } = run;
  const caller = { id, org, playbook, journal, meta: { [runIdKey]: id } };
  return images === undefined ? caller : { ...caller, keepImage: imagesKeptOn(images, run) };
}

function opened({
  access,
  references,
  run,
  before,
  images,
}: Opening): Effect.Effect<RunTools, Unavailable | JournalRefusal> {
  return access.open(callerOf(run, images), references).pipe(
    Effect.catchTags({
      tool_not_offered: ({ because, detail }: Refused<NotOfferedBecause>) =>
        refusedAfter(before, { detail, kind: 'tool_not_offered', because }),
      tool_server_failed: ({ because, detail }: Refused<ServerFailedBecause>) =>
        refusedAfter(before, { detail, kind: 'tool_server_failed', because }),
    }),
  );
}

export function withTools<A, E>(
  opening: Opening,
  use: (tools?: RunTools) => Effect.Effect<A, E>,
): Effect.Effect<A, E | Unavailable | JournalRefusal> {
  if (opening.references.length === 0) {
    return use();
  }
  return opened(opening).pipe(
    Effect.flatMap((tools) => use(tools).pipe(Effect.ensuring(Effect.promise(() => tools.close())))),
  );
}
