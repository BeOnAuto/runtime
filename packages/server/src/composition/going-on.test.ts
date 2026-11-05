import { Effect, Exit } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { memoryRuntime } from '../testing/records/memory-runtime.ts';
import { goingOnIn, RunNotGoneOn } from './going-on.ts';

describe('going on with a run once its request ends', () => {
  it('fails, so the due work tries it again later, when the server cannot go on with the run', async () => {
    const runtime = await memoryRuntime();
    onTestFinished(() => runtime.dispose());
    const goOn = goingOnIn(runtime, []);

    const exit = await Effect.runPromiseExit(
      goOn(
        { org: 'acme', playbook: 'alpha', id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
        { causationId: null, correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
      ),
    );

    expect(exit).toEqual(
      Exit.fail(
        new RunNotGoneOn('The run 0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a did not go on after its request: rejected'),
      ),
    );
  });
});
