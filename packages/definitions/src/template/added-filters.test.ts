import { readFileSync } from 'node:fs';

import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { templateEngine, type RenderFailure } from '../template.ts';
import { renderedText } from '../testing/rendered-text.ts';

const engine = templateEngine();

function rendering(body: string, value: Schema.Json): Result.Result<string, RenderFailure> {
  return renderedText(engine, body, { input: { value } });
}

function rendered(body: string, value: Schema.Json): string {
  return Result.getOrThrow(rendering(body, value));
}

function rejection(body: string, value: Schema.Json): RenderFailure | null {
  return Result.match(rendering(body, value), { onSuccess: () => null, onFailure: (failure) => failure });
}

const corpus: readonly (readonly [string, Schema.Json])[] = [
  ['{{ input.value | money }}', 364_028],
  ['{{ input.value | money }}', -1_250_000],
  ['{{ input.value | money }}', 1234.5],
  ['{{ input.value | money }}', ' 19.99 '],
  ['{{ input.value | money }}', 'many'],
  ['{{ input.value | clip }}', 'a'.repeat(401)],
  ['{{ input.value | clip: 5 }}', 'Hello, world'],
  ['{{ input.value | clip: 2 }}', '😀😀😀'],
  ['{{ input.value | clip: 3 }}', 123_456],
  ['{{ input.value | clip: 3 }}', null],
  ['{{ input.value | clip: -1 }}', 'Hello'],
  ['{{ input.value | words }}', 'The quick  brown\n\tfox'],
  ['{{ input.value | words }}', null],
  ['{% assign n = input.value | words %}{% if n > 2 %}long{% else %}short{% endif %}', 'a b c'],
];

const captured: unknown = JSON.parse(readFileSync(new URL('added-filters-corpus.json', import.meta.url), 'utf8'));

describe('the templates of the filters in the rendering corpus', () => {
  it('render as they rendered when the corpus was captured, when the filters were the reasoning capability’s', () => {
    expect(
      corpus.map(([body, value]) => ({
        body,
        rendering: Result.match(rendering(body, value), {
          onSuccess: (text) => ({ rendered: text }),
          onFailure: (failure) => ({ failure }),
        }),
      })),
    ).toEqual(captured);
  });
});

describe('money, beyond the corpus', () => {
  it('writes zero as no dollars, rounds to the cent, and takes text that is a whole number', () => {
    expect(rendered('{{ input.value | money }}', 0)).toBe('$0');
    expect(rendered('{{ input.value | money }}', 0.125)).toBe('$0.13');
    expect(rendered('{{ input.value | money }}', '364028')).toBe('$364,028');
  });

  it('rejects empty text, nothing and a list', () => {
    const detail = { reason: 'failed', detail: 'money takes a number, or text that is a decimal number', line: 1 };

    expect(rejection('{{ input.value | money }}', '')).toEqual(detail);
    expect(rejection('{{ input.value | money }}', null)).toEqual(detail);
    expect(rejection('{{ input.value | money }}', [1])).toEqual(detail);
  });
});

describe('clip, beyond the corpus', () => {
  it('keeps text of 400 characters by default, and text no longer than the length it is given', () => {
    expect(rendered('{{ input.value | clip }}', 'a'.repeat(400))).toBe('a'.repeat(400));
    expect(rendered('{{ input.value | clip: 12 }}', 'Hello, world')).toBe('Hello, world');
    expect(rendered('{{ input.value | clip: 3 }}', '😀😀😀')).toBe('😀😀😀');
  });

  it('keeps only the ellipsis at a length of 0', () => {
    expect(rendered('{{ input.value | clip: 0 }}', 'Hello')).toBe('…');
  });

  it('rejects a length that is not a whole number, or that is text', () => {
    const detail = {
      reason: 'failed',
      detail: 'clip takes a length in characters, a whole number of 0 or more',
      line: 1,
    };

    expect(rejection('{{ input.value | clip: 2.5 }}', 'Hello')).toEqual(detail);
    expect(rejection('{{ input.value | clip: "3" }}', 'Hello')).toEqual(detail);
  });
});

describe('words, beyond the corpus', () => {
  it('counts a word between spaces, and none in empty or blank text', () => {
    expect(rendered('{{ input.value | words }}', '  padded  ')).toBe('1');
    expect(rendered('{{ input.value | words }}', '')).toBe('0');
    expect(rendered('{{ input.value | words }}', '   ')).toBe('0');
  });
});
