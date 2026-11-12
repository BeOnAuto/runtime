import { describe, expect, it } from 'vitest';

import { answerDocument, answerOf, decodeToolResult, resultText } from './tool-results.ts';

const notes = '# Notes\n\nShip on Friday.';

const fileOfNotes = { type: 'resource', resource: { uri: 'file:///notes.md', mimeType: 'text/markdown', text: notes } };

const pdf = {
  type: 'resource',
  resource: { uri: 'file:///terms.pdf', mimeType: 'application/pdf', blob: 'JVBERi0xLjQK' },
};

const linkToTheTerms = {
  type: 'resource_link',
  uri: 'file:///terms.pdf',
  name: 'terms.pdf',
  title: 'Terms',
  description: 'The terms of the order',
  mimeType: 'application/pdf',
  size: 1_048_576,
  annotations: { audience: ['user'] },
  icons: [{ src: 'https://example.com/pdf.png' }],
  _meta: { 'com.example/id': 'f-1' },
};

const shownOfTheLink =
  '{"type":"resource_link","uri":"file:///terms.pdf","name":"terms.pdf","title":"Terms","description":"The terms of the order","mimeType":"application/pdf","size":1048576}';

const aLine = { type: 'text', text: 'Read notes.md at 3f2a1c.' };

function shown(...content: readonly unknown[]): string {
  return resultText(decodeToolResult({ content }));
}

describe('the text a model sees of an embedded resource', () => {
  it('is the text of one that holds text, as a text block shows, in the order the tool gave its blocks', () => {
    expect([shown(aLine, fileOfNotes), shown(fileOfNotes, aLine)]).toEqual([
      `Read notes.md at 3f2a1c.\n${notes}`,
      `${notes}\nRead notes.md at 3f2a1c.`,
    ]);
  });

  it('is a placeholder naming its type for one that holds a blob, never its bytes', () => {
    const unnamed = { type: 'resource', resource: { uri: 'file:///a.bin', blob: 'AAEC' } };

    expect([shown(pdf), shown(unnamed)]).toEqual([
      '[resource content (application/pdf), not shown]',
      '[resource content, not shown]',
    ]);
  });

  it('is its text for one that declares both text and a blob, with nothing of the blob', () => {
    const both = { type: 'resource', resource: { uri: 'file:///a.md', text: notes, blob: 'JVBERi0xLjQK' } };

    expect([shown(both), answerDocument(answerOf(JSON.stringify({ content: [both] })))]).toEqual([notes, notes]);
  });

  it('keeps structured content from the model when it holds text, and gives it beside one that holds a blob', () => {
    expect([
      resultText(decodeToolResult({ content: [pdf], structuredContent: { name: 'Ada' } })),
      resultText(decodeToolResult({ content: [fileOfNotes], structuredContent: { name: 'Ada' } })),
    ]).toEqual(['{"name":"Ada"}\n[resource content (application/pdf), not shown]', notes]);
  });
});

describe('the text a model sees of the other kinds of content', () => {
  it('is the fields of a resource link in JSON, without its annotations, icons or metadata', () => {
    expect([shown(linkToTheTerms), shown({ type: 'resource_link', uri: 'file:///a.txt', name: 'a.txt' })]).toEqual([
      shownOfTheLink,
      '{"type":"resource_link","uri":"file:///a.txt","name":"a.txt"}',
    ]);
  });

  it('is a placeholder naming the type of an image, a sound, and content of a kind it does not read', () => {
    expect(
      shown(
        { type: 'image', data: 'AA==', mimeType: 'image/png' },
        { type: 'audio', data: 'AA==', mimeType: 'audio/wav' },
        { type: 'hologram', mimeType: 'model/gltf+json' },
        { type: 'hologram' },
      ),
    ).toBe(
      '[image content (image/png), not shown]\n[audio content (audio/wav), not shown]\n[hologram content (model/gltf+json), not shown]\n[hologram content, not shown]',
    );
  });
});

const broken: readonly unknown[] = [
  { type: 'text' },
  { type: 'text', text: 7 },
  { type: 'resource' },
  { type: 'resource', resource: { uri: 'file:///a.md', mimeType: 'text/markdown' } },
  { type: 'resource', resource: { uri: 'file:///a.md', text: 7 } },
  { type: 'resource', resource: { text: 'no address' } },
  { type: 'resource_link', uri: 'file:///a.md' },
  { type: 'image', data: 'AA==', mimeType: 5 },
  { type: 'hologram', mimeType: { major: 'model' } },
];

describe('a block that breaks the shape of its kind', () => {
  it('is read as a placeholder naming its type, and never fails the reading of its result', () => {
    expect(shown(...broken)).toBe(
      [
        '[text content, not shown]',
        '[text content, not shown]',
        '[resource content, not shown]',
        '[resource content, not shown]',
        '[resource content, not shown]',
        '[resource content, not shown]',
        '[resource_link content, not shown]',
        '[image content, not shown]',
        '[hologram content, not shown]',
      ].join('\n'),
    );
    expect(answerDocument(answerOf(JSON.stringify({ content: broken })))).toBeUndefined();
  });
});

const answers: ReadonlyArray<readonly [string, unknown, string, unknown]> = [
  [
    'structured content with its JSON text, which the two read alike',
    { content: [{ type: 'text', text: '{"rows":2}' }], structuredContent: { rows: 2 } },
    '{"rows":2}',
    { rows: 2 },
  ],
  [
    'structured content beside a summary, where the model sees the summary and the document is the structure',
    { content: [{ type: 'text', text: '2 rows.' }], structuredContent: { rows: 2 } },
    '2 rows.',
    { rows: 2 },
  ],
  [
    'structured content beside a file, where the model sees the file and the document is the structure',
    { content: [fileOfNotes], structuredContent: { rows: 2 } },
    notes,
    { rows: 2 },
  ],
  [
    'several text blocks, which both read joined, and the document as JSON where the joined text is JSON',
    {
      content: [
        { type: 'text', text: '{"page":1,' },
        { type: 'text', text: '"of":2}' },
      ],
    },
    '{"page":1,\n"of":2}',
    { page: 1, of: 2 },
  ],
  [
    'several text blocks whose joined text is not JSON, which the document reads as that text',
    {
      content: [
        { type: 'text', text: '{"page":1}' },
        { type: 'text', text: '{"page":2}' },
      ],
    },
    '{"page":1}\n{"page":2}',
    '{"page":1}\n{"page":2}',
  ],
  [
    'a line about a file and the file, which both read in that order',
    { content: [aLine, fileOfNotes] },
    `Read notes.md at 3f2a1c.\n${notes}`,
    `Read notes.md at 3f2a1c.\n${notes}`,
  ],
  [
    'a file alone that holds JSON, which the document reads as JSON',
    { content: [{ type: 'resource', resource: { uri: 'file:///rows.json', text: '{"rows":2}' } }] },
    '{"rows":2}',
    { rows: 2 },
  ],
  [
    'a blob beside a line, where the document is the line alone',
    { content: [{ type: 'text', text: 'Done.' }, pdf] },
    'Done.\n[resource content (application/pdf), not shown]',
    'Done.',
  ],
  [
    'only a blob, which the document does not have',
    { content: [pdf] },
    '[resource content (application/pdf), not shown]',
    undefined,
  ],
  ['only a resource link, which the document does not have', { content: [linkToTheTerms] }, shownOfTheLink, undefined],
  [
    'only an image, which the model sees as a placeholder and the document does not have',
    { content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }] },
    '[image content (image/png), not shown]',
    undefined,
  ],
  ['nothing', { content: [] }, '(The tool answered with no content.)', undefined],
  [
    'a text that is not JSON, which both read as that text',
    { content: [{ type: 'text', text: 'Done.' }] },
    'Done.',
    'Done.',
  ],
];

describe('the two readings of one answer', () => {
  it.each(answers)('of %s', (_case, answer, seen, document) => {
    expect([resultText(decodeToolResult(answer)), answerDocument(answerOf(JSON.stringify(answer)))]).toEqual([
      seen,
      document,
    ]);
  });
});
