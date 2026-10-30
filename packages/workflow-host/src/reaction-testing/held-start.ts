import { Effect, type Exit } from 'effect';

import type { WorkflowHost } from '../host/workflow-host.ts';
import type { ReactionStart, StartReaction } from '../reactions/reaction-options.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';

type StartExit = Exit.Exit<unknown, unknown>;

export interface HeldStart {
  readonly start: StartReaction;
  readonly begun: Promise<void>;
  readonly release: (host: WorkflowHost) => void;
  readonly exits: () => readonly StartExit[];
}

const listening = workflow('do:\n  - await: { listen: { to: { one: { with: { type: com.acme.decided } } } } }');

export function heldStart(): HeldStart {
  const begun = Promise.withResolvers<void>();
  const released = Promise.withResolvers<WorkflowHost>();
  const exits: StartExit[] = [];
  const startedOn = (host: WorkflowHost, { runId }: ReactionStart) =>
    Effect.gen(function* () {
      exits.push(yield* Effect.exit(host.start(runAt(runId), startOf(listening))));
    });
  return {
    start: (start) =>
      Effect.promise(() => {
        begun.resolve();
        return released.promise;
      }).pipe(Effect.flatMap((host) => startedOn(host, start))),
    begun: begun.promise,
    release: released.resolve,
    exits: () => exits,
  };
}
