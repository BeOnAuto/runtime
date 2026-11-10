import { Buffer } from 'node:buffer';

import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { parsedTemplate } from '../template/template-parsing.ts';
import { standingRenderClock } from '../testing/time/stepping-clock.ts';
import { renderedText, toolBlockEngine } from './text-rendering.ts';

function rendered(text: string, variables: Readonly<Record<string, Schema.Json>>, mostBytes: number) {
  return Result.flatMap(parsedTemplate(toolBlockEngine, text, 1), (parsed) =>
    renderedText(parsed, variables, mostBytes, standingRenderClock),
  );
}

const tooLong = Result.fail({ reason: 'too_long', line: 1 });

const pieces = ['a', 'é', '€', '😀', '\uD83D', '\uDE00', ''];

const eachPart = '{% for part in parts %}{{ part }}{% endfor %}';

function randomness(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) % 2 ** 32;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

function partsOf(seed: number): readonly string[] {
  const next = randomness(seed);
  return Array.from({ length: 1 + Math.floor(next() * 12) }, () => pieces[Math.floor(next() * pieces.length)] ?? '');
}

function isCountedAsAWhole(seed: number): boolean {
  const parts = partsOf(seed);
  const bytes = Buffer.byteLength(parts.join(''), 'utf8');
  return (
    Result.isSuccess(rendered(eachPart, { parts }, bytes)) && Result.isFailure(rendered(eachPart, { parts }, bytes - 1))
  );
}

describe('the text of a template', () => {
  it('may take its bytes in UTF-8 written at once, and is refused one byte past them', () => {
    const text = `é${'a'.repeat(7)}€`;
    expect([rendered('{{ text }}', { text }, 12), rendered('{{ text }}', { text }, 11)]).toEqual([
      Result.succeed(text),
      tooLong,
    ]);
  });

  it('may take its bytes in UTF-8 written in many small parts, and is refused one byte past them', () => {
    const parts = Array.from({ length: 500 }, () => ['é', 'a']).flat();
    const loop = '{% for part in parts %}{{ part }}-{% endfor %}';
    expect([rendered(loop, { parts }, 2500), rendered(loop, { parts }, 2499)]).toEqual([
      Result.succeed(parts.map((part) => `${part}-`).join('')),
      tooLong,
    ]);
  });

  it('counts a character its writes split in two as the one character it is once joined, an empty write between them', () => {
    const halves = '{{ face | slice: 0, 1 }}{{ face | slice: 1, 1 }}';
    expect([
      rendered(halves, { face: '😀' }, 4),
      rendered(halves, { face: '😀' }, 3),
      rendered('{{ face | slice: 0, 1 }}{{ "" }}{{ face | slice: 1, 1 }}', { face: '😀' }, 4),
      rendered('{{ face | slice: 0, 1 }}{{ "" }}x', { face: '😀' }, 4),
    ]).toEqual([Result.succeed('😀'), tooLong, Result.succeed('😀'), Result.succeed('\uD83Dx')]);
  });

  it('counts, whatever parts it is written in, the bytes Buffer.byteLength counts of the whole text', () => {
    const seeds = Array.from({ length: 2000 }, (_, index) => index + 1);

    expect(seeds.filter((seed) => !isCountedAsAWhole(seed))).toEqual([]);
  });
});
