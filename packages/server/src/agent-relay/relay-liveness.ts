import { Effect, Option, Ref, Schedule } from 'effect';

import type { PingOutcome } from '../runtime-recovery/runtime-ping.ts';
import type { RelayBounds } from './relay-bounds.ts';

const silent: PingOutcome = 'silent';

export class Liveness {
  readonly #ping: Effect.Effect<PingOutcome>;
  readonly #bounds: RelayBounds;
  readonly #heard = Ref.makeUnsafe(false);

  constructor(ping: Effect.Effect<PingOutcome>, bounds: RelayBounds) {
    this.#ping = ping;
    this.#bounds = bounds;
  }

  pinged(): Effect.Effect<PingOutcome> {
    const { pingTimeoutMs, pingTries, pingSpacingMs } = this.#bounds;
    return this.#ping.pipe(
      Effect.timeoutOption(pingTimeoutMs),
      Effect.map(Option.getOrElse(() => silent)),
      Effect.flatMap((seen) => (seen === silent ? Effect.fail(seen) : Effect.succeed(seen))),
      Effect.retry({ schedule: Schedule.spaced(pingSpacingMs), times: pingTries - 1 }),
      Effect.orElseSucceed(() => silent),
      Effect.tap((seen) => (seen === 'answers' ? this.heard() : Effect.void)),
    );
  }

  heard(): Effect.Effect<void> {
    return Ref.set(this.#heard, true);
  }

  heardBefore(): Effect.Effect<boolean> {
    return Ref.get(this.#heard);
  }
}
