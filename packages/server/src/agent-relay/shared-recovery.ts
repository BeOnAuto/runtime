import { Deferred, Effect, type Scope } from 'effect';

import type { PingOutcome } from '../runtime-recovery/runtime-ping.ts';
import type { Recovery } from '../runtime-recovery/runtime-recovery.ts';
import type { Liveness } from './relay-liveness.ts';

export type Recover = (seen: PingOutcome, heardBefore: boolean) => Effect.Effect<Recovery>;

export class SharedRecovery {
  readonly #liveness: Liveness;
  readonly #recover: Recover;
  #underWay: Deferred.Deferred<Recovery> | undefined;
  #replacing = false;

  constructor(liveness: Liveness, recover: Recover) {
    this.#liveness = liveness;
    this.#recover = recover;
  }

  replacing(): boolean {
    return this.#replacing;
  }

  recovered(seen?: PingOutcome): Effect.Effect<Recovery, never, Scope.Scope> {
    return Effect.suspend(() => {
      const underWay = this.#underWay;
      if (underWay !== undefined) {
        return Deferred.await(underWay);
      }
      const recovery = Deferred.makeUnsafe<Recovery>();
      this.#underWay = recovery;
      const recovering = this.#recovery(seen).pipe(
        Effect.flatMap((recovered) => Deferred.succeed(recovery, recovered)),
        Effect.ensuring(
          Effect.sync(() => {
            this.#underWay = undefined;
            this.#replacing = false;
          }),
        ),
      );
      return Effect.forkScoped(recovering).pipe(Effect.andThen(Deferred.await(recovery)));
    });
  }

  #recovery(seen: PingOutcome | undefined): Effect.Effect<Recovery> {
    return Effect.gen({ self: this }, function* () {
      const observed = seen ?? (yield* this.#liveness.pinged());
      this.#replacing = observed === 'silent';
      return yield* this.#recover(observed, yield* this.#liveness.heardBefore());
    });
  }
}
