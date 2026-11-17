import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { DescriptionSchema } from '../document.ts';
import { issueText, reportedIssues } from './document-issue.ts';
import { splitDocument } from './document-split.ts';
import { frontMatterIn, type FrontMatterShape, type ReadFrontMatter } from './front-matter-keys.ts';

const NoteSchema = Schema.Struct({
  title: Schema.String,
  size: Schema.optionalKey(Schema.Number),
  extra: Schema.optionalKey(
    Schema.Struct({
      anything: Schema.optionalKey(Schema.Json),
      deeper: Schema.optionalKey(Schema.Struct({ kept: Schema.optionalKey(Schema.String) })),
    }),
  ),
});

const note: FrontMatterShape = {
  sections: [
    { name: undefined, keys: Object.keys(NoteSchema.fields) },
    { name: 'extra', keys: ['anything', 'deeper'] },
    { name: 'extra.deeper', keys: ['kept'] },
  ],
  decode: Schema.decodeUnknownResult(NoteSchema, { errors: 'all' }),
  required: 'the title',
};

function read(source: string): Result.Result<ReadFrontMatter, readonly string[]> {
  return Result.mapError(
    Result.flatMap(splitDocument(source, 'A note'), ({ frontMatter, frontMatterLine }) =>
      frontMatterIn(frontMatter, frontMatterLine, note),
    ),
    (issues) => reportedIssues(issues).map((issue) => issueText(issue)),
  );
}

function issuesIn(source: string): readonly string[] {
  return Result.match(read(source), {
    onSuccess: ({ issues }) => reportedIssues(issues).map((issue) => issueText(issue)),
    onFailure: (issues) => issues,
  });
}

function rootOf(source: string): Schema.JsonObject {
  return Result.getOrThrow(read(source)).root;
}

function documentOf(frontMatter: string): string {
  return `---\n${frontMatter}\n---\nThe body`;
}

function withListsNested(levels: number): string {
  const lists = levels - 2;
  return documentOf(`title: Deep\nextra:\n  anything: {x: ${'['.repeat(lists)}${']'.repeat(lists)}}`);
}

describe('the split of a document', () => {
  it('needs front matter that opens on the first line, named for what the document defines', () => {
    expect(issuesIn('title: A\n---\nBody')).toEqual([expect.stringContaining('Line 1:')]);
  });

  it('needs front matter that is closed', () => {
    expect(issuesIn('---\ntitle: A\nBody')).toEqual([expect.stringContaining('Line 1:')]);
  });

  it('takes Windows line endings, a byte order mark and spaces after the dashes, and finds where the body starts', () => {
    expect(splitDocument('﻿--- \r\ntitle: A\r\n---\t\r\nLine one\r\nLine two', 'A note')).toEqual(
      Result.succeed({ frontMatter: 'title: A', frontMatterLine: 2, body: 'Line one\nLine two', bodyLine: 4 }),
    );
  });
});

describe('the front matter', () => {
  it('is YAML that can be read, a mapping, and not empty, which names what the document needs', () => {
    expect(issuesIn(documentOf('title: {a: 1'))).toEqual([expect.stringContaining('Line 2:')]);
    expect(issuesIn(documentOf('# only a comment'))).toEqual([expect.stringContaining('Line 2:')]);
    expect(issuesIn(documentOf('- title: A'))).toEqual(['Line 2: The front matter is a mapping of keys to values']);
  });

  it('has no aliases, anchors or tags', () => {
    expect(issuesIn(documentOf('title: &chosen A\nsize: !!int 7\nextra:\n  anything: *chosen'))).toEqual([
      'Line 2, /title: An anchor (&chosen) is not allowed',
      'Line 3, /size: A tag (tag:yaml.org,2002:int) is not allowed',
      expect.stringContaining('Line 5, /extra/anything:'),
    ]);
    expect(issuesIn(documentOf('&root\ntitle: A'))).toEqual(['Line 2: An anchor (&root) is not allowed']);
  });

  it('nests at most 72 levels, however deep it goes', () => {
    expect(issuesIn(withListsNested(72))).toEqual([]);
    expect(issuesIn(withListsNested(73))).toEqual([
      `Line 4, /extra/anything/x${'/0'.repeat(70)}: The front matter may nest at most 72 levels`,
    ]);
    expect(issuesIn(withListsNested(30_000))).toEqual(['Line 4: The front matter may nest at most 72 levels']);
  });

  it('has no key twice and holds only finite numbers', () => {
    expect(issuesIn(documentOf('title: A\nsize: .inf\ntitle: B'))).toEqual([
      expect.stringContaining('Line 3, /size:'),
      'Line 4, /title: The key title appears more than once',
    ]);
  });
});

describe('the values of the front matter', () => {
  it('reads keys as text, an empty value as null, and keeps keys that name prototypes as plain keys', () => {
    expect(
      rootOf(documentOf('title: A\nextra:\n  anything:\n    1: one\n    empty:\n    ? alone\n    __proto__: {x: 1}')),
    ).toEqual({
      title: 'A',
      extra: {
        anything: Object.fromEntries<Schema.Json>([
          ['1', 'one'],
          ['empty', null],
          ['alone', null],
          ['__proto__', { x: 1 }],
        ]),
      },
    });
  });
});

describe('the keys of the front matter', () => {
  it('are the ones its document takes, at every level, with the types each takes', () => {
    expect(issuesIn(documentOf('size: big\nprompt: hi\nextra:\n  other: 1'))).toEqual([
      'Line 1, /title: title is required',
      'Line 2, /size: Expected number',
      expect.stringContaining('Line 3, /prompt:'),
      expect.stringContaining('Line 5, /extra/other:'),
    ]);
  });

  it('are checked in a section nested in another, named by its path', () => {
    expect(issuesIn(documentOf('title: A\nextra:\n  deeper:\n    kept: yes\n    lost: 1'))).toEqual([
      expect.stringContaining('Line 6, /extra/deeper/lost:'),
    ]);
    expect(issuesIn(documentOf('title: A\nextra: 5'))).toHaveLength(1);
  });

  it('are reported at most 20 at once, with how many more there were', () => {
    const many = Array.from({ length: 23 }, (_, index) => `key${index}: 1`).join('\n');

    expect(issuesIn(documentOf(`title: A\n${many}`))).toHaveLength(21);
    expect(issuesIn(documentOf(`title: A\n${many}`)).at(-1)).toBe('Line 23: 3 more issues are not shown');
  });
});

const holds = Schema.is(DescriptionSchema);

describe('the description of a function document', () => {
  it('takes 1 to 1,000 characters', () => {
    expect([holds(''), holds('x'), holds('x'.repeat(1000)), holds('x'.repeat(1001))]).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});
