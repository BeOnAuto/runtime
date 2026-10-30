import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';

import { shippedRoots } from '../server-options/shipped-roots.ts';
import { computationServedBy, workerPool, type ProgramPoolOf, type ServedComputation } from './served-computation.ts';

interface Closing {
  readonly closed: readonly string[];
  readonly closes: (what: string) => void;
  readonly served: () => Promise<ServedComputation>;
}

function closingRecorded(): Closing {
  const closed: string[] = [];
  const closes = (what: string) => {
    closed.push(what);
  };
  const poolOf: ProgramPoolOf = (settings, handed) => {
    const pool = workerPool(settings, handed);
    return {
      ...pool,
      close: async () => {
        closes('pool');
        await pool.close();
      },
    };
  };
  return {
    closed,
    closes,
    served: () => computationServedBy({ workers: 1 }, poolOf, shippedFilesOnDisk(shippedRoots)),
  };
}

describe('the pool of workers of a server', () => {
  it('closes after every other service as the runtime is disposed', async () => {
    const { closed, closes, served } = closingRecorded();
    const computation = await served();
    const services = Layer.effectDiscard(
      Effect.addFinalizer(() =>
        Effect.sync(() => {
          closes('services');
        }),
      ),
    );
    const runtime = ManagedRuntime.make(computation.closedLastOf(services));

    await runtime.runPromise(Effect.void);
    await runtime.dispose();

    expect(closed).toEqual(['services', 'pool']);
  });

  it('closes when the services fail to start, and when what is made with it is refused', async () => {
    const { closed, served } = closingRecorded();
    const failed = await served();
    const runtime = ManagedRuntime.make(failed.closedLastOf(Layer.effectDiscard(Effect.die('The ledger is refused'))));
    const refused = await served();

    await expect(runtime.runPromise(Effect.void)).rejects.toThrow('The ledger is refused');
    await expect(
      refused.closedIfRefused(() => {
        throw new Error('The extension is refused');
      }),
    ).rejects.toThrow('The extension is refused');
    expect(closed).toEqual(['pool', 'pool']);
  });
});
