import { Effect, type Exit } from 'effect';

import type { WorkflowHost } from '../host/workflow-host.ts';
import type { ReactionStart, StartReaction } from '../reactions/reaction-options.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import type { SteppedClock } from '../testing/stepped-clock.ts';

type StartExit = Exit.Exit<unknown, unknown>;

export interface HeldStart {
  readonly start: StartReaction;
  readonly begun: Promise<void>;
  readonly release: (host: WorkflowHost) => void;
  readonly exits: () => readonly StartExit[];
}

const listening = workflow('do:\n  - await: { listen: { to: { one: { with: { type: com.acme.decided } } } } }');

/** A start of a reaction held until the test lets it go, the wait asleep on the clock of the host so it can rest. */
export function heldStart(clock: SteppedClock): HeldStart {
  const begun = Promise.withResolvers<void>();
  const work = clock.hold();
  const released = Promise.withResolvers<WorkflowHost>();
  const exits: StartExit[] = [];
  const startedOn = (host: WorkflowHost, { runId }: ReactionStart) =>
    Effect.gen(function* () {
      exits.push(yield* Effect.exit(host.start(runAt(runId), startOf(listening))));
    });
  return {
    start: (start) =>
      Effect.suspend(() => {
        begun.resolve();
        return work.wait;
      }).pipe(
        Effect.andThen(Effect.promise(() => released.promise)),
        Effect.flatMap((host) => startedOn(host, start)),
      ),
    begun: begun.promise,
    release: (host) => {
      released.resolve(host);
      work.release();
    },
    exits: () => exits,
  };
}
