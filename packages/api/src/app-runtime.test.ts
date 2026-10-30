import { Data, Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeAppRuntime } from './index.ts';

class LayerFailed extends Data.TaggedError('LayerFailed')<{ readonly message: string }> {}

describe('makeAppRuntime', () => {
  it('resolves an effect to its value', async () => {
    const runtime = await makeAppRuntime(Layer.empty);

    expect(await runtime.run(Effect.succeed(42))).toBe(42);
  });

  it('reports an effect that interrupts itself as cancelled', async () => {
    const runtime = await makeAppRuntime(Layer.empty);

    expect(await runtime.run(Effect.interrupt)).toEqual({ status: 'cancelled' });
  });

  it('cancels an effect in flight when disposed, and every effect run after that', async () => {
    const runtime = await makeAppRuntime(Layer.empty);
    const inFlight = runtime.run(Effect.never);
    await runtime.dispose();

    expect(await inFlight).toEqual({ status: 'cancelled' });
    expect(await runtime.run(Effect.succeed(1))).toEqual({ status: 'cancelled' });
  });

  it('rejects with the cause of a defect', async () => {
    const runtime = await makeAppRuntime(Layer.empty);

    await expect(runtime.run(Effect.die(new Error('boom')))).rejects.toThrow('boom');
  });

  it('fails to start when a layer fails to build', async () => {
    await expect(
      makeAppRuntime(Layer.effectDiscard(Effect.fail(new LayerFailed({ message: 'no ledger' })))),
    ).rejects.toThrow('no ledger');
  });
});

describe('an effect run with a signal', () => {
  it('cancels an effect in flight when its signal aborts, interrupting it so its finalizers run', async () => {
    const runtime = await makeAppRuntime(Layer.empty);
    const aborting = new AbortController();
    const finalized: string[] = [];
    const inFlight = runtime.run(
      Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            finalized.push('interrupted');
          }),
        ),
      ),
      aborting.signal,
    );

    aborting.abort();

    expect(await inFlight).toEqual({ status: 'cancelled' });
    expect(finalized).toEqual(['interrupted']);
  });
});
