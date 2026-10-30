import type { CallResult } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';

const notifying = workflow('do:\n  - notify: { call: notify, with: { to: ada } }');

describe('the host told to stop just after it admitted a start', () => {
  it('lets the start finish, then stops the call it began, so nothing outlives the stop', async () => {
    const answers = { begun: 0, stopped: 0 };
    const answeredOnlyWhenStopped: Effect.Effect<CallResult> = Effect.sync(() => {
      answers.begun += 1;
    }).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          answers.stopped += 1;
        }),
      ),
    );
    const hosted = await hostedOn(
      { store: 'sqlite', file: aSQLiteFile() },
      { answer: () => answeredOnlyWhenStopped, sweepEveryMs: 3_600_000 },
    );

    const starting = Effect.runPromise(
      hosted.host.start(runAt('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a'), startOf(notifying)),
    );
    const stopping = hosted.host.stop();
    const started = await starting;
    await stopping;

    expect(started).toBe('started');
    expect(answers).toEqual({ begun: 1, stopped: 1 });
    expect(hosted.troubles()).toEqual([]);
  });
});
