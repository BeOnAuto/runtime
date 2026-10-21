import {
  isJSONRPCErrorResponse,
  isJSONRPCResultResponse,
  type RequestId,
  type Transport,
} from '@modelcontextprotocol/server';
import { Deferred, Effect, Option } from 'effect';

import { isTheStopAnswer } from '../runtime-recovery/runtime-losses.ts';
import type { RelayBounds } from './relay-bounds.ts';
import type { Liveness } from './relay-liveness.ts';
import { lost, RuntimeCall, type Ending } from './runtime-call.ts';

export interface Cancellation {
  readonly awaited: Effect.Effect<void>;
  readonly happened: Effect.Effect<boolean>;
}

export class RuntimeCalls {
  readonly #calls = new Map<unknown, RuntimeCall>();
  readonly #cancellations = new Map<unknown, Deferred.Deferred<void>>();
  readonly #liveness: Liveness;
  readonly #bounds: RelayBounds;

  constructor(liveness: Liveness, bounds: RelayBounds) {
    this.#liveness = liveness;
    this.#bounds = bounds;
  }

  asked(id: RequestId): Cancellation {
    const cancellation = Deferred.makeUnsafe<void>();
    this.#cancellations.set(id, cancellation);
    return { awaited: Deferred.await(cancellation), happened: Deferred.isDone(cancellation) };
  }

  settled(id: RequestId): void {
    this.#cancellations.delete(id);
  }

  heardOn(id: RequestId): void {
    this.#calls.get(id)?.heard();
  }

  answered(message: unknown): void {
    if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
      this.#calls.get(message.id)?.answered();
    }
  }

  stoppedOn(message: unknown): boolean {
    if (!isTheStopAnswer(message)) {
      return false;
    }
    this.#calls.get(message.id)?.stopped();
    return true;
  }

  cancelled(id: RequestId): void {
    const cancellation = this.#cancellations.get(id);
    if (cancellation !== undefined) {
      Deferred.doneUnsafe(cancellation, Effect.void);
    }
  }

  attempt(
    runtime: Readonly<Transport>,
    id: RequestId,
    request: unknown,
    cancellation: Cancellation,
  ): Effect.Effect<Ending> {
    const call = new RuntimeCall(cancellation.awaited);
    this.#calls.set(id, call);
    return call.ending(runtime, request, this.#watched(call.silence(this.#bounds.silenceMs))).pipe(
      Effect.tap((ending) => (ending.kind === 'answered' ? this.#liveness.heard() : Effect.void)),
      Effect.ensuring(
        Effect.sync(() => {
          this.#calls.delete(id);
        }),
      ),
    );
  }

  #watched(silence: Effect.Effect<Option.Option<void>>): Effect.Effect<never, Ending> {
    const beat = silence.pipe(
      Effect.map(Option.isSome),
      Effect.flatMap((heard) => (heard ? this.#liveness.heard() : this.#stillAnswering())),
    );
    return Effect.forever(beat);
  }

  #stillAnswering(): Effect.Effect<void, Ending> {
    return this.#liveness
      .pinged()
      .pipe(
        Effect.flatMap((seen) =>
          seen === 'answers' ? Effect.void : Effect.fail(lost('unanswered', 'Auto Runtime did not answer', seen)),
        ),
      );
  }
}
