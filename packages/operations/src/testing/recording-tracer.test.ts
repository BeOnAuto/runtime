import { Effect, Tracer } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordingTracer } from './recording-tracer.ts';

const linked = Tracer.externalSpan({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });

describe('a recording tracer', () => {
  it('records each span as it starts, with its parent, its links, its attributes and how it ended', async () => {
    const { tracer, spans } = recordingTracer();
    await Effect.runPromise(
      Effect.void.pipe(
        Effect.withSpan('inner', {
          kind: 'client',
          attributes: { size: 3 },
          links: [{ span: linked, attributes: {} }],
        }),
        Effect.withSpan('outer'),
        Effect.withTracer(tracer),
      ),
    );
    const [outer, inner] = spans();

    expect(outer).toMatchObject({ name: 'outer', kind: 'internal', parentSpanId: undefined, ending: 'succeeded' });
    expect(inner).toMatchObject({
      name: 'inner',
      kind: 'client',
      traceId: outer?.traceId,
      parentSpanId: outer?.spanId,
      attributes: { size: 3 },
      links: [{ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }],
      ending: 'succeeded',
    });
    expect(inner?.spanId).toMatch(/^[0-9a-f]{16}$/u);
  });

  it('records a span whose effect failed as failed, and one that has not ended as open', async () => {
    const { tracer, spans } = recordingTracer();
    await Effect.runPromise(
      Effect.all([
        Effect.exit(Effect.fail('broken').pipe(Effect.withSpan('failing'))),
        Effect.makeSpan('unended'),
      ]).pipe(Effect.withTracer(tracer)),
    );

    expect(spans().map(({ name, ending }) => `${name} ${ending}`)).toEqual(['failing failed', 'unended open']);
  });
});
