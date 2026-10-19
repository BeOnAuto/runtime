import { standingRenderClock } from '@on.auto/definitions/testing';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RenderFailure } from './compiled-template.ts';
import { compileTemplate } from './template-compilation.ts';

function rendering(body: string, value: Schema.Json): Result.Result<string, RenderFailure> {
  const template = Result.getOrThrow(compileTemplate(body, 1));
  return Result.map(
    template.render({ input: { value }, today: '2026-10-01', now: '2026-10-01T00:00:00.000Z' }, standingRenderClock),
    ({ message }) => message,
  );
}

function rendered(body: string, value: Schema.Json): string {
  return Result.getOrThrow(rendering(body, value));
}

function rejection(body: string, value: Schema.Json): RenderFailure | null {
  return Result.match(rendering(body, value), { onSuccess: () => null, onFailure: (failure) => failure });
}

describe('money', () => {
  it('writes a whole number as US dollars with thousands separators and no decimals', () => {
    expect(rendered('{{ input.value | money }}', 364_028)).toBe('$364,028');
    expect(rendered('{{ input.value | money }}', 0)).toBe('$0');
    expect(rendered('{{ input.value | money }}', -1_250_000)).toBe('-$1,250,000');
  });

  it('writes cents when the number is not whole', () => {
    expect(rendered('{{ input.value | money }}', 1234.5)).toBe('$1,234.50');
    expect(rendered('{{ input.value | money }}', 0.125)).toBe('$0.13');
  });

  it('takes text that is a decimal number', () => {
    expect(rendered('{{ input.value | money }}', '364028')).toBe('$364,028');
    expect(rendered('{{ input.value | money }}', ' 19.99 ')).toBe('$19.99');
  });

  it('rejects anything else', () => {
    const detail = { reason: 'failed', detail: 'money takes a number, or text that is a decimal number', line: 1 };

    expect(rejection('{{ input.value | money }}', 'twelve')).toEqual(detail);
    expect(rejection('{{ input.value | money }}', '')).toEqual(detail);
    expect(rejection('{{ input.value | money }}', null)).toEqual(detail);
    expect(rejection('{{ input.value | money }}', [1])).toEqual(detail);
  });
});

describe('clip', () => {
  it('keeps text of 400 characters or fewer by default', () => {
    expect(rendered('{{ input.value | clip }}', 'a'.repeat(400))).toBe('a'.repeat(400));
  });

  it('cuts longer text to 400 characters and appends an ellipsis', () => {
    expect(rendered('{{ input.value | clip }}', 'a'.repeat(401))).toBe(`${'a'.repeat(400)}…`);
  });

  it('takes the number of characters to keep', () => {
    expect(rendered('{{ input.value | clip: 5 }}', 'Hello, world')).toBe('Hello…');
    expect(rendered('{{ input.value | clip: 12 }}', 'Hello, world')).toBe('Hello, world');
    expect(rendered('{{ input.value | clip: 0 }}', 'Hello')).toBe('…');
  });

  it('counts characters, not the units of their encoding', () => {
    expect(rendered('{{ input.value | clip: 3 }}', '😀😀😀')).toBe('😀😀😀');
    expect(rendered('{{ input.value | clip: 2 }}', '😀😀😀')).toBe('😀😀…');
  });

  it('writes other values as text first', () => {
    expect(rendered('{{ input.value | clip: 3 }}', 123_456)).toBe('123…');
    expect(rendered('{{ input.value | clip: 3 }}', null)).toBe('');
  });

  it('rejects a length that is not a whole number of 0 or more', () => {
    const detail = {
      reason: 'failed',
      detail: 'clip takes a length in characters, a whole number of 0 or more',
      line: 1,
    };

    expect(rejection('{{ input.value | clip: -1 }}', 'Hello')).toEqual(detail);
    expect(rejection('{{ input.value | clip: 2.5 }}', 'Hello')).toEqual(detail);
    expect(rejection('{{ input.value | clip: "3" }}', 'Hello')).toEqual(detail);
  });
});

describe('words', () => {
  it('counts the words in a text', () => {
    expect(rendered('{{ input.value | words }}', 'The quick  brown\n\tfox')).toBe('4');
    expect(rendered('{{ input.value | words }}', '  padded  ')).toBe('1');
  });

  it('counts none in an empty text or in nothing', () => {
    expect(rendered('{{ input.value | words }}', '')).toBe('0');
    expect(rendered('{{ input.value | words }}', '   ')).toBe('0');
    expect(rendered('{{ input.value | words }}', null)).toBe('0');
  });

  it('can be compared in a condition', () => {
    expect(rendered('{% assign n = input.value | words %}{% if n > 2 %}long{% else %}short{% endif %}', 'a b c')).toBe(
      'long',
    );
  });
});
