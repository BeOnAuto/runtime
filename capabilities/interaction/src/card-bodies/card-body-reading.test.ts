import { splitDocument } from '@on.auto/definitions/document';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { readCardBody } from './card-body-reading.ts';

function partsOf(body: string) {
  return Result.getOrThrow(splitDocument(`---\nto: x\n---\n${body}`, 'A definition'));
}

function readingOf(body: string) {
  return readCardBody(partsOf(body));
}

function issuesOf(body: string): readonly string[] {
  const reading = readingOf(body);
  return Result.isFailure(reading) ? reading.failure.map(({ line, detail }) => `${line}: ${detail}`) : [];
}

describe('the body of a request with render', () => {
  it('is read as the card it writes, each place of it keeping its line', () => {
    const reading = Result.getOrThrow(
      readingOf('root: card\nelements:\n  card:\n    type: Card\n    children: [a, b]\n'),
    );

    expect(reading.card).toEqual({ root: 'card', elements: { card: { type: 'Card', children: ['a', 'b'] } } });
    expect(
      ['', '/root', '/elements', '/elements/card/type', '/elements/card/children/1'].map((at) => reading.lines.get(at)),
    ).toEqual([4, 4, 5, 7, 8]);
  });

  it('keeps the line of a key that holds a mapping or a list, and of an item nested in a list', () => {
    const reading = Result.getOrThrow(readingOf('list:\n  - a: 1\n    b: [2]\n  - ~\n'));

    expect(reading.card).toEqual({ list: [{ a: 1, b: [2] }, null] });
    expect(['/list', '/list/0', '/list/0/b', '/list/0/b/0', '/list/1'].map((at) => reading.lines.get(at))).toEqual([
      4, 5, 6, 6, 7,
    ]);
  });

  it('escapes a key that holds a slash in its pointer', () => {
    const reading = Result.getOrThrow(readingOf('a/b: 1\n'));

    expect(reading.lines.get('/a~1b')).toBe(4);
  });

  it('keeps a line for a key written with no value, and refuses a key that is not text', () => {
    const reading = Result.getOrThrow(readingOf('{ a }\n'));

    expect([reading.card, reading.lines.get('/a')]).toEqual([{ a: null }, 4]);
    expect(issuesOf('? [x]\n: 1\n')).toEqual(['4: With stringKeys, all keys must be strings']);
  });
});

describe('a body that cannot be read as a card', () => {
  it('is refused when it is empty or holds only a comment', () => {
    const detail = 'The definition has no message: write its card, with root and elements, after the front matter';

    expect([issuesOf(''), issuesOf('# nothing yet\n')]).toEqual([[`4: ${detail}`], [`4: ${detail}`]]);
  });

  it('is refused with its line when it is not YAML', () => {
    expect(issuesOf('root: card\nelements: [a\n')).toEqual([expect.stringMatching(/^\d+: /u)]);
    expect(issuesOf('a: 1\na: 2\n')).toEqual([expect.stringContaining('Map keys must be unique')]);
  });

  it('is refused for an alias, which would write a value twice', () => {
    expect(issuesOf('a: &x [1]\nb: *x\n')).toEqual(['5: An alias (*x) is not allowed; write the value out']);
  });

  it('is refused for a value that is not plain JSON', () => {
    expect(issuesOf('a: .inf\n')).toEqual(['4: The body is not plain JSON']);
  });
});
