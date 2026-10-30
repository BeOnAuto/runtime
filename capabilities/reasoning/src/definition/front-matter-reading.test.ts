import { describe, expect, it } from 'vitest';

import { documentOf, issuesIn, parsed } from '../testing/definition-documents.ts';

describe('the split of a document', () => {
  it('needs front matter that opens on the first line', () => {
    expect(issuesIn('model: openai/gpt-5\n---\nHello')).toEqual([
      'Line 1: A reasoning function definition starts with a line of three dashes (---) that opens its front matter of YAML',
    ]);
    expect(issuesIn('\n---\nmodel: openai/gpt-5\n---\nHello')).toHaveLength(1);
  });

  it('needs front matter that is closed, and never reads it as the template', () => {
    expect(issuesIn('---\nmodel: openai/gpt-5\nHello {{ input.name }}')).toEqual([
      'Line 1: The front matter that opens on line 1 is never closed by a line of three dashes (---)',
    ]);
  });

  it('takes Windows line endings, a byte order mark and spaces after the dashes', () => {
    expect(parsed('﻿--- \r\nmodel: openai/gpt-5\r\n---\t\r\nLine one\r\nLine two').model).toBe('openai/gpt-5');
  });

  it('counts the lines of the template from the document', () => {
    expect(issuesIn('---\nmodel: openai/gpt-5\n\n---\n\nHello {{ input.name | nope }}')).toEqual([
      'Line 6: undefined filter: nope',
    ]);
  });
});

describe('the front matter', () => {
  it('is YAML that can be read', () => {
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig: {temperature: 0.2'))).toEqual([
      'Line 3: Flow map in block collection must be sufficiently indented and end with a }',
    ]);
  });

  it('is a mapping, and not empty', () => {
    expect(issuesIn(documentOf('# only a comment'))).toEqual([
      'Line 2: The front matter is empty; it names at least the model',
    ]);
    expect(issuesIn(documentOf('- model: openai/gpt-5'))).toEqual([
      'Line 2: The front matter is a mapping of keys to values',
    ]);
  });

  it('has no aliases, anchors or tags', () => {
    expect(
      issuesIn(
        documentOf(
          'model: &chosen openai/gpt-5\ndescription: *chosen\nconfig:\n  seed: !!int 7\nprovider_options: !custom {}',
        ),
      ),
    ).toEqual([
      'Line 2, /model: An anchor (&chosen) is not allowed',
      'Line 3, /description: An alias (*chosen) is not allowed; write the value out',
      'Line 5, /config/seed: A tag (tag:yaml.org,2002:int) is not allowed',
      'Line 6, /provider_options: A tag (!custom) is not allowed',
    ]);
    expect(issuesIn(documentOf('&root\nmodel: openai/gpt-5'))).toEqual(['Line 2: An anchor (&root) is not allowed']);
  });
});

function withListsNested(levels: number): string {
  const lists = levels - 2;
  return documentOf(
    `model: openai/gpt-5\nprovider_options:\n  internal: {x: ${'['.repeat(lists)}${']'.repeat(lists)}}`,
  );
}

describe('the nesting of the front matter', () => {
  it('stops at 72 levels', () => {
    expect(issuesIn(withListsNested(72))).toEqual([]);
    expect(issuesIn(withListsNested(73))).toEqual([
      `Line 4, /provider_options/internal/x${'/0'.repeat(70)}: The front matter may nest at most 72 levels`,
    ]);
  });

  it('stops at 72 levels however deep it goes, past what the YAML reader can follow', () => {
    const flow = withListsNested(30_000);
    const block = `---\nmodel: openai/gpt-5\nprovider_options:\n  anthropic:\n    x:\n      ${'- '.repeat(30_000)}1\n---\nHi`;

    expect([flow.length, block.length].every((length) => length <= 65_536)).toBe(true);
    expect(issuesIn(flow)).toEqual(['Line 4: The front matter may nest at most 72 levels']);
    expect(issuesIn(block)).toEqual(['Line 6: The front matter may nest at most 72 levels']);
  });
});

describe('the values of the front matter', () => {
  it('have no key twice in one mapping', () => {
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig:\n  seed: 1\n  seed: 2\nmodel: openai/gpt-4'))).toEqual([
      'Line 5, /config/seed: The key seed appears more than once',
      'Line 6, /model: The key model appears more than once',
    ]);
  });

  it('hold only finite numbers', () => {
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig:\n  temperature: .inf\n  top_p: .nan'))).toEqual([
      'Line 4, /config/temperature: Expected text, a finite number, true, false or null',
      'Line 5, /config/top_p: Expected text, a finite number, true, false or null',
    ]);
  });

  it('reads keys as text, an empty value as null, and a key without a value as null', () => {
    expect(
      parsed(
        documentOf(
          'model: openai/gpt-5\nprovider_options:\n  internal:\n    1: one\n    true: yes\n    empty:\n    ? alone',
        ),
      ).provider_options,
    ).toEqual({ internal: { 1: 'one', true: 'yes', empty: null, alone: null } });
  });

  it('keeps keys that name object prototypes as plain keys', () => {
    expect(
      parsed(documentOf('model: openai/gpt-5\nprovider_options:\n  internal:\n    __proto__: {polluted: true}'))
        .provider_options,
    ).toEqual({
      internal: Object.fromEntries([['__proto__', { polluted: true }]]),
    });
    expect({}).not.toHaveProperty('polluted');
  });
});
