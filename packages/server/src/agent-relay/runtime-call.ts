import { parseJSONRPCMessage, type Transport } from '@modelcontextprotocol/server';
import { Deferred, Effect, type Option } from 'effect';

import { lossOf, saidOf, type Loss } from '../runtime-recovery/runtime-losses.ts';
import type { PingOutcome } from '../runtime-recovery/runtime-ping.ts';

export type Ending =
  | { readonly kind: 'answered' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'lost'; readonly loss: Loss; readonly said: string; readonly seen: PingOutcome | undefined };

const answered: Ending = { kind: 'answered' };

const cancelled: Ending = { kind: 'cancelled' };

export function lost(loss: Loss, said: string, seen?: PingOutcome): Ending {
  return { kind: 'lost', loss, said, seen };
}

const endedUnanswered = lost('stopped', 'Auto Runtime ended its answer before the answer came');

const stoppedMidCall = lost('stopped', 'Auto Runtime answered that it stopped while it handled the request');

type Sending = { readonly failed: false } | { readonly failed: true; readonly failure: unknown };

export class RuntimeCall {
  readonly #answered = Deferred.makeUnsafe<void>();
  readonly #stopped = Deferred.makeUnsafe<void>();
  readonly #ended = Deferred.makeUnsafe<void>();
  readonly #cancellation: Effect.Effect<void>;
  readonly #sending = new AbortController();
  #nextPiece = Deferred.makeUnsafe<void>();

  constructor(cancellation: Effect.Effect<void>) {
    this.#cancellation = cancellation;
  }

  heard(): void {
    Deferred.doneUnsafe(this.#nextPiece, Effect.void);
    this.#nextPiece = Deferred.makeUnsafe<void>();
  }

  answered(): void {
    Deferred.doneUnsafe(this.#answered, Effect.void);
  }

  stopped(): void {
    Deferred.doneUnsafe(this.#stopped, Effect.void);
  }

  ending(
    runtime: Readonly<Transport>,
    request: unknown,
    watching: Effect.Effect<never, Ending>,
  ): Effect.Effect<Ending> {
    return Effect.raceAll([
      Deferred.await(this.#answered).pipe(Effect.as(answered)),
      Deferred.await(this.#stopped).pipe(Effect.as(stoppedMidCall)),
      this.#cancellation.pipe(Effect.as(cancelled)),
      Deferred.await(this.#ended).pipe(Effect.as(endedUnanswered)),
      this.#sent(runtime, request),
      Effect.flip(watching),
    ]).pipe(
      Effect.tap((ending) =>
        Effect.sync(() => {
          if (ending.kind !== 'answered') {
            this.#sending.abort();
          }
        }),
      ),
    );
  }

  silence(silenceMs: number): Effect.Effect<Option.Option<void>> {
    return Effect.suspend(() => Deferred.await(this.#nextPiece).pipe(Effect.timeoutOption(silenceMs)));
  }

  #sent(runtime: Readonly<Transport>, request: unknown): Effect.Effect<Ending> {
    const sending = runtime
      .send(parseJSONRPCMessage(request), {
        requestSignal: this.#sending.signal,
        onRequestStreamEnd: () => {
          Deferred.doneUnsafe(this.#ended, Effect.void);
        },
      })
      .then(
        (): Sending => ({ failed: false }),
        (failure: unknown): Sending => ({ failed: true, failure }),
      );
    return Effect.promise(() => sending).pipe(
      Effect.flatMap((sent) =>
        sent.failed && !this.#sending.signal.aborted
          ? Effect.succeed(lost(lossOf(sent.failure), saidOf(sent.failure)))
          : Effect.never,
      ),
    );
  }
}
