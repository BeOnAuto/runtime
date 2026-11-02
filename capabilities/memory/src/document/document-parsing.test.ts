import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryDocument, memoryInput, recallDocument, rememberDocument } from '../testing/documents.ts';
import { parseMemoryDocument } from './document-parsing.ts';

function parsed(source: string) {
  return Result.getOrThrow(parseMemoryDocument(source));
}

function issuesOf(source: string): readonly { readonly pointer: string; readonly detail: string }[] {
  return Result.match(parseMemoryDocument(source), {
    onSuccess: () => [],
    onFailure: (issues) => issues.map(({ pointer, detail }) => ({ pointer, detail })),
  });
}

describe('a memory function that remembers', () => {
  it('reads its text, its tags, its scope, the span it is about, how long it is kept and what it replaces', () => {
    const { description, block } = parsed(
      rememberDocument([
        "tags: ['decisions', '{{ input.about }}']",
        'scope: organization',
        "about: { from: '2026-10-01', to: '2026-12-31' }",
        'expires: P30D',
        "replaces: '{{ input.replaces }}'",
      ]),
    );

    expect(description).toBe('Keeps what the team decided');
    expect(block).toMatchObject({
      kind: 'remember',
      remember: {
        text: { pointer: '/remember/text' },
        tags: [{ pointer: '/remember/tags/0' }, { pointer: '/remember/tags/1' }],
        scope: 'organization',
        about: { from: { pointer: '/remember/about/from' }, to: { pointer: '/remember/about/to' } },
        expires: { pointer: '/remember/expires' },
        replaces: { pointer: '/remember/replaces' },
      },
    });
  });

  it('is kept by the playbook, with no tag, when its block names neither, and takes no input schema', () => {
    const { block, input } = parsed(rememberDocument([], []));

    expect(block).toMatchObject({
      kind: 'remember',
      remember: { text: { template: { text: '{{ input.fact }}' } }, tags: [], scope: 'playbook' },
    });
    expect(input).toEqual({});
  });
});

describe('a memory function that remembers, out of bounds', () => {
  it('refuses literals out of bounds where they are written, each in words that name the bound', () => {
    const issues = issuesOf(
      memoryDocument([
        'remember:',
        `  text: '${'x'.repeat(2001)}'`,
        `  tags: [${Array.from({ length: 9 }, (_, at) => `tag-${at}`).join(', ')}]`,
        "  about: { from: '2026-12-31', to: '2026-10-01' }",
        '  expires: PT12H',
        '  replaces: someone',
        '  scope: team',
      ]),
    );

    expect(issues).toEqual([
      {
        pointer: '/remember/text',
        detail: 'The text of a memory holds at most 2,000 characters, and this one has 2,001',
      },
      { pointer: '/remember/tags', detail: 'A memory takes at most 8 tags, and these are 9' },
      {
        pointer: '/remember/about',
        detail: 'What a memory is about ends on 2026-10-01, before it begins on 2026-12-31',
      },
      {
        pointer: '/remember/expires',
        detail:
          'PT12H is not a time a memory may be kept. A memory expires after a duration from P1D to P3650D, such as P30D',
      },
      { pointer: '/remember/replaces', detail: '"someone" is not the id of a memory' },
      {
        pointer: '/remember/scope',
        detail: '"team" is no scope: a memory is kept by the playbook, playbook, or by its organization, organization',
      },
    ]);
  });
});

describe('a memory function that remembers what is no value', () => {
  it('refuses an empty text, a tag that is no tag, a day that is no day and a duration that is none', () => {
    const issues = issuesOf(
      memoryDocument([
        'remember:',
        "  text: ''",
        "  tags: ['Decisions']",
        "  about: { from: '2026-02-30', to: '{{ input.to }}' }",
        '  expires: P1Y',
      ]),
    );

    expect(issues.map(({ pointer }) => pointer)).toEqual([
      '/remember/text',
      '/remember/tags/0',
      '/remember/about/from',
      '/remember/expires',
    ]);
    expect(issues[3]?.detail).toContain('counts years or months');
  });
});

describe('a memory function that recalls', () => {
  it('reads its words, its tags, its scope and the most characters it recalls, both scopes and 4,000 when it names neither', () => {
    const named = parsed(
      recallDocument(["words: '{{ input.fact }}'", "tags: ['decisions']", 'scope: playbook', 'most_characters: 800']),
    );
    const plain = parsed(recallDocument());

    expect([named.block, plain.block]).toMatchObject([
      { kind: 'recall', recall: { words: { pointer: '/recall/words' }, scope: 'playbook', mostCharacters: 800 } },
      { kind: 'recall', recall: { tags: [], scope: 'both', mostCharacters: 4000 } },
    ]);
    expect(plain.block).not.toHaveProperty(['recall', 'words']);
  });

  it('takes its words as written, with no template in them', () => {
    expect(parsed(recallDocument(["words: 'thursdays'"]))).toMatchObject({
      block: { recall: { words: { template: { text: 'thursdays' } } } },
    });
  });

  it('refuses a scope it does not know and a number of characters out of bounds', () => {
    expect(issuesOf(recallDocument(['scope: everyone', 'most_characters: 16001']))).toEqual([
      {
        pointer: '/recall/scope',
        detail:
          '"everyone" is no scope: a recall reads the playbook\'s memories, playbook, its organization\'s, organization, or both, both',
      },
      { pointer: '/recall/most_characters', detail: 'A recall answers 1 to 16,000 characters of text, not 16001' },
    ]);
  });
});

describe('the document of a memory function', () => {
  it('takes one of remember and recall, never both and never neither', () => {
    const both = memoryDocument(['remember:', "  text: 'x'", 'recall: {}']);
    const neither = memoryDocument(['description: Nothing to do']);

    expect([issuesOf(both), issuesOf(neither)]).toEqual([
      [
        {
          pointer: '/recall',
          detail: 'A memory function remembers or recalls, so it takes remember or recall, not both',
        },
      ],
      [
        {
          pointer: '',
          detail: 'A memory function takes remember, to write what it remembers, or recall, to say what it recalls',
        },
      ],
    ]);
  });

  it('refuses a body, a key it does not take, a remember without text and a block that is not one', () => {
    expect(issuesOf(memoryDocument(['remember:', "  text: 'x'"], 'A body'))).toEqual([
      {
        pointer: '',
        detail:
          'A memory function takes no body: write what it remembers or recalls in its front matter, under remember or recall',
      },
    ]);
    expect(issuesOf(memoryDocument(['remember:', "  text: 'x'", '  model: any'])).map(({ detail }) => detail)).toEqual([
      'model is not a key of remember; it takes text, tags, scope, about, expires, replaces',
    ]);
    expect(issuesOf(memoryDocument(['remember: { tags: [] }'])).map(({ detail }) => detail)).toEqual([
      'text is required',
    ]);
    expect(issuesOf(memoryDocument(['remember: 3'], 'And a body')).length).toBe(2);
  });
});

describe('the templates and the front matter of a memory function', () => {
  it('refuses a template it cannot read, or that reads what the input does not hold', () => {
    const closed = [...memoryInput.slice(0, 3), '    additionalProperties: false', ...memoryInput.slice(3)];

    expect(issuesOf(rememberDocument(["tags: ['{{ input.tag']"])).map(({ pointer }) => pointer)).toEqual([
      '/remember/tags/0',
    ]);
    expect(issuesOf(rememberDocument(["tags: ['{{ input.team }}']"], closed))).toMatchObject([
      {
        pointer: '/remember/tags/0',
        detail: 'input.team is not a property of the input schema, which allows no others',
      },
    ]);
    expect(issuesOf(rememberDocument(["tags: ['{{ team }}']"])).map(({ detail }) => detail)).toEqual([
      'team is not a variable of the templates of a memory function, which reads input, today and now; assign it first',
    ]);
  });

  it('needs no description, and refuses front matter that holds nothing', () => {
    expect(parsed(memoryDocument(['recall: {}']))).not.toHaveProperty('description');
    const [empty, body] = issuesOf(memoryDocument([], 'A body'));

    expect(empty?.detail).toContain('a remember block or a recall block');
    expect(body?.detail).toContain('takes no body');
  });

  it('refuses an input schema that does not compile, and a document that opens no front matter', () => {
    expect(issuesOf(rememberDocument([], ['input:', '  schema: { type: nothing }']))).toMatchObject([
      { pointer: '/input/schema/type' },
    ]);
    expect(issuesOf('remember: {}')).toMatchObject([{ pointer: '' }]);
  });
});
