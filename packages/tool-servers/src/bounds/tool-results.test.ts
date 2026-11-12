import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { secretsOf } from './secrets.ts';
import { bytesOf, canonicalJson, cutAsStored, cutAtCodePoint } from './text-bytes.ts';
import {
  answerOf,
  decodeListedTools,
  decodeToolResult,
  errorTextForModel,
  errorTextForOperator,
  metaValueOf,
  resultText,
} from './tool-results.ts';

const scrub = secretsOf([Redacted.make('graph-api-key-4f1d9a7c2b')]).scrub;

describe('the text the model sees of a result', () => {
  it('shows text content as text, line by line', () => {
    expect(
      resultText(
        decodeToolResult({
          content: [
            { type: 'text', text: 'Found 2 rows.' },
            { type: 'text', text: 'Page 1 of 1.' },
          ],
          structuredContent: { rows: 2 },
        }),
      ),
    ).toBe('Found 2 rows.\nPage 1 of 1.');
  });

  it('shows structured content only when there is no text content', () => {
    expect(resultText(decodeToolResult({ content: [], structuredContent: { name: 'Ada' } }))).toBe('{"name":"Ada"}');
  });

  it('says when a result has no content', () => {
    expect(resultText(decodeToolResult({ content: [] }))).toBe('(The tool answered with no content.)');
  });

  it('reads a key of the metadata of a result', () => {
    expect(metaValueOf(decodeToolResult({ content: [], _meta: { 'com.example/id': 'r-1' } }), 'com.example/id')).toBe(
      'r-1',
    );
    expect(metaValueOf(decodeToolResult({ content: [] }), 'com.example/id')).toBeUndefined();
  });
});

describe('the tools a server lists', () => {
  it('are read with their title, the four hints of their annotations and the title of the annotations, and nothing else', () => {
    const hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
    const listed = [
      {
        name: 'search',
        title: 'Search',
        inputSchema: { type: 'object' },
        annotations: { ...hints, title: 'Search' },
        icons: [],
      },
      { name: 'post', inputSchema: { type: 'object' } },
    ];

    expect(decodeListedTools({ tools: listed }).tools).toEqual([
      { name: 'search', title: 'Search', inputSchema: { type: 'object' }, annotations: { ...hints, title: 'Search' } },
      { name: 'post', inputSchema: { type: 'object' } },
    ]);
  });
});

describe('error text', () => {
  it('bounds the words of an error the model sees, scrubbed of secrets', () => {
    const said = errorTextForModel(`  Rejected graph-api-key-4f1d9a7c2b: ${'x'.repeat(400)}  `, scrub);

    expect(said).toHaveLength(300);
    expect(said).toMatch(/^Rejected \[redacted\]: x+$/u);
  });

  it('bounds the words of an error the operator reads, scrubbed of secrets', () => {
    const said = errorTextForOperator(`Rejected Bearer graph-api-key-4f1d9a7c2b ${'x'.repeat(3000)}`, scrub);

    expect(said).toHaveLength(2000);
    expect(said).toMatch(/^Rejected Bearer \[redacted\] x+$/u);
  });
});

describe('text as bytes', () => {
  it('counts the UTF-8 bytes of text', () => {
    expect(bytesOf('😀a')).toBe(5);
  });

  it('cuts text at a code point', () => {
    expect(cutAtCodePoint('a😀b', 3)).toBe('a');
    expect(cutAtCodePoint('a😀b', 5)).toBe('a😀');
    expect(cutAtCodePoint('a😀b', 6)).toBe('a😀b');
    expect(cutAtCodePoint('a😀b', -1)).toBe('');
  });

  it('cuts text to the bytes it takes when stored as a JSON string', () => {
    expect(cutAsStored('plain', 5)).toBe('plain');
    expect(cutAsStored('a"b', 3)).toBe('a"');
    expect(cutAsStored('\u0001\u0001', 7)).toBe('\u0001');
    expect(cutAsStored('😀😀', 4)).toBe('😀');
  });

  it('writes JSON with its keys in order, at every depth', () => {
    expect(canonicalJson({ c: 1, a: [{ z: 1, y: 2 }], b: { e: 2, d: 1 } })).toBe(
      '{"a":[{"y":2,"z":1}],"b":{"d":1,"e":2},"c":1}',
    );
  });
});

describe('the answer of a tool as its caller reads it', () => {
  it('is its content and structured content, and no content at all when its JSON cannot be read', () => {
    expect([
      answerOf(JSON.stringify({ content: [{ type: 'text', text: 'Posted.' }], structuredContent: { ts: '1.1' } })),
      answerOf('{[redacted]: []}'),
    ]).toEqual([{ content: [{ type: 'text', text: 'Posted.' }], structuredContent: { ts: '1.1' } }, { content: [] }]);
  });
});
