import { Clock, Effect, Result, type Schema } from 'effect';
import { toValue, type Emitter } from 'liquidjs';
import { describe, expect, it } from 'vitest';

import {
  engineFailureOf,
  linesOf,
  outputText,
  parsedTemplate,
  renderClock,
  renderClockOf,
  renderedTemplate,
  templateEngine,
  type RenderClock,
  type RenderFailure,
} from '../template.ts';
import { standingRenderClock, steppingClock } from '../testing/time/stepping-clock.ts';

class NotText extends Error {}

function refusing(): never {
  throw new TypeError('the filter refused its value');
}

const engine = templateEngine(() => ({ filters: { refuse: refusing } }));

function emitterRefusingObjects(): Emitter & { readonly text: () => string } {
  let written = '';
  return {
    buffer: '',
    write(html: unknown) {
      const value: unknown = toValue(html);
      if (typeof value === 'object' && value !== null) {
        throw new NotText('not text');
      }
      written += outputText(value);
    },
    text: () => written,
  };
}

function refusedAsNotText(
  cause: unknown,
  line: number,
): { readonly reason: 'not_text'; readonly line: number } | undefined {
  return cause instanceof NotText ? { reason: 'not_text', line } : undefined;
}

function renderingOn(
  clock: RenderClock,
  body: string,
  variables: Readonly<Record<string, Schema.Json>> = {},
  firstLine = 1,
) {
  const parsed = Result.getOrThrow(parsedTemplate(engine, body, firstLine));
  const emitter = emitterRefusingObjects();
  return Result.map(renderedTemplate(engine, parsed, { variables, emitter, refusalOf: refusedAsNotText, clock }), () =>
    emitter.text(),
  );
}

function rendering(body: string, variables: Readonly<Record<string, Schema.Json>> = {}, firstLine = 1) {
  return renderingOn(standingRenderClock, body, variables, firstLine);
}

function loopOf(times: number): string {
  return `Hello\n{% for i in (1..${times}) %}{% endfor %}`;
}

describe('a render', () => {
  it('reads the variables it is given and writes text', () => {
    expect(rendering('{{ to }}: {{ message | upcase }} ({{ count }})', { to: 'ada', message: 'hi', count: 2 })).toEqual(
      Result.succeed('ada: HI (2)'),
    );
  });

  it('answers what the emitter refuses, at the line it refused', () => {
    expect(rendering('Hello\n{{ schema }}', { schema: { type: 'object' } }, 3)).toEqual(
      Result.fail({ reason: 'not_text', line: 4 }),
    );
    expect(rendering('{{ schema | json }}', { schema: { type: 'object' } })).toEqual(
      Result.succeed('{"type":"object"}'),
    );
  });

  const failures: ReadonlyArray<readonly [string, string, RenderFailure]> = [
    ['a missing variable', '{{ nowhere.here }}', { reason: 'missing_variable', variable: 'nowhere', line: 1 }],
    [
      'a filter that fails',
      '{{ "x" | refuse }}',
      { reason: 'failed', detail: 'the filter refused its value', line: 1 },
    ],
    [
      'too much memory',
      '{% for i in (1..6000000) %}{% endfor %}',
      { reason: 'limit_exceeded', limit: 'memory', line: 1 },
    ],
  ];

  it.each(failures)('fails with %s', (_case, body, failure) => {
    expect(rendering(body)).toEqual(Result.fail(failure));
  });
});

describe('the time a render may take', () => {
  it('is counted on the clock the render is given, which a render may read 200 ms past its start, and is stopped at the next read past them, at the line of the block it ran in', () => {
    expect(renderingOn(renderClockOf(steppingClock(1)), loopOf(150))).toEqual(Result.succeed('Hello\n'));
    expect(renderingOn(renderClockOf(steppingClock(1)), loopOf(400))).toEqual(
      Result.fail({ reason: 'limit_exceeded', limit: 'time', line: 2 }),
    );
  });

  it('stops no render whose clock stands still, so the loop the moving clock stops renders on it', () => {
    expect(renderingOn(standingRenderClock, loopOf(400))).toEqual(Result.succeed('Hello\n'));
  });

  it('is read from an Effect clock as the milliseconds of its monotonic time, the clock of the effect that renders', () => {
    const reads = Effect.runSync(renderClock.pipe(Effect.provideService(Clock.Clock, steppingClock(2))));

    expect([reads(), reads(), renderClockOf({ monotonicTimeNanosUnsafe: () => 1_500_000n })()]).toEqual([0, 2, 1.5]);
  });
});

describe('the place of a failure of the engine', () => {
  it('is the line of an offset in the document, and the first line for a failure not of the engine', () => {
    const lineOf = linesOf('a\nb\nc', 10);

    expect([lineOf(0), lineOf(2), lineOf(4)]).toEqual([10, 11, 12]);
    expect(engineFailureOf(new Error('boom'), 7)).toMatchObject({
      line: 7,
      message: 'Error: boom',
      missingVariable: undefined,
    });
  });
});
