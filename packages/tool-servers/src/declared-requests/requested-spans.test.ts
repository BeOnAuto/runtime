import { recordingTracer } from '@on.auto/operations/testing';
import { Context, Effect, Tracer } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DeclaredRequest, RequestedOnce } from './declared-requests.ts';
import { tracedRequest } from './requested-spans.ts';

const subscribing: DeclaredRequest = { method: 'POST', url: 'https://api.tracker.example.com/projects/acme-web/hooks' };

const answered: RequestedOnce = { kind: 'answered', outcome: 'result', answer: {} };

describe('the sending of a request through a connection', () => {
  it('runs under a span that does not propagate, so the HTTP client meets no parent to record its path under', async () => {
    const propagated: boolean[] = [];
    const sending = Effect.gen(function* () {
      const { annotations } = yield* Effect.orDie(Effect.currentSpan);
      propagated.push(!Context.get(annotations, Tracer.DisablePropagation));
      return answered;
    });
    const recording = recordingTracer();
    await Effect.runPromise(tracedRequest(subscribing, sending).pipe(Effect.withTracer(recording.tracer)));

    expect(propagated).toEqual([false]);
    expect(recording.spans().map(({ name, kind }) => [name, kind])).toEqual([['POST', 'client']]);
  });
});
