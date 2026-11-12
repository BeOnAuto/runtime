import { describe, expect, it } from 'vitest';

import { bytesOf } from '../bounds/text-bytes.ts';
import { answerOf, resultText } from '../bounds/tool-results.ts';
import { shownFormat, type CallAnswered } from './call-facts.ts';
import { keptReply } from './recorded-replies.ts';
import { textShownInFormatOne } from './shown-format-one.ts';

function keptOf(answer: unknown): string {
  return JSON.stringify(answer);
}

describe('the text a model was shown of an answer in format 1', () => {
  it('shows text content as text, line by line', () => {
    expect(
      textShownInFormatOne(
        keptOf({
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
    expect(textShownInFormatOne(keptOf({ content: [], structuredContent: { name: 'Ada' } }))).toBe('{"name":"Ada"}');
  });
});

describe('the content a model was shown in format 1 as a placeholder', () => {
  it('shows other content as a placeholder naming its type, an embedded resource and a resource link among it', () => {
    expect(
      textShownInFormatOne(
        keptOf({
          content: [
            { type: 'image', data: 'AA==', mimeType: 'image/png' },
            { type: 'resource_link', uri: 'file:///terms.pdf', name: 'terms.pdf', mimeType: 'application/pdf' },
            { type: 'resource', resource: { uri: 'file:///notes.md', mimeType: 'text/markdown', text: '# Notes' } },
            { type: 'text' },
          ],
        }),
      ),
    ).toBe(
      '[image content (image/png), not shown]\n[resource_link content (application/pdf), not shown]\n[resource content, not shown]\n[text content, not shown]',
    );
  });

  it('shows structured content before the placeholders of a result whose only text is a file', () => {
    expect(
      textShownInFormatOne(
        keptOf({
          content: [{ type: 'resource', resource: { uri: 'file:///notes.md', text: '# Notes' } }],
          structuredContent: { rows: 2 },
        }),
      ),
    ).toBe('{"rows":2}\n[resource content, not shown]');
  });

  it('says when a result has no content, or when what was kept cannot be read', () => {
    expect([textShownInFormatOne(keptOf({ content: [] })), textShownInFormatOne('{[redacted]: []}')]).toEqual([
      '(The tool answered with no content.)',
      '(The tool answered with no content.)',
    ]);
  });
});

const onlyText: ReadonlyArray<readonly [string, unknown]> = [
  ['one text block', { content: [{ type: 'text', text: 'Found 2 rows for acme.' }] }],
  [
    'several text blocks',
    {
      content: [
        { type: 'text', text: '{"page":1}' },
        { type: 'text', text: '{"page":2}' },
      ],
    },
  ],
  [
    'text blocks beside structured content',
    { content: [{ type: 'text', text: '2 rows.' }], structuredContent: { rows: 2 } },
  ],
  ['structured content alone', { content: [], structuredContent: { name: 'Ada', rows: 2 } }],
  ['a tool error', { content: [{ type: 'text', text: 'The field salary is denied' }], isError: true }],
  ['text of many code points', { content: [{ type: 'text', text: '😀'.repeat(4096) }] }],
  ['JSON text', { content: [{ type: 'text', text: JSON.stringify({ rows: [{ id: 1 }, { id: 2 }] }) }] }],
  [
    'an empty text block beside another',
    {
      content: [
        { type: 'text', text: '' },
        { type: 'text', text: 'Done.' },
      ],
    },
  ],
  ['nothing', { content: [] }],
];

function answeredWith(fields: Partial<CallAnswered>): CallAnswered {
  return { is_error: false, result_bytes: 1, duration_ms: 1, jsonrpc_id: 1, ...fields };
}

describe('an answer that holds only text blocks', () => {
  it.each(onlyText)(
    'reads alike byte for byte in format 1 and in the format this release shows, of %s',
    (_case, answer) => {
      const kept = keptOf(answer);

      expect(textShownInFormatOne(kept)).toBe(resultText(answerOf(kept)));
    },
  );

  it.each(onlyText)(
    'is shown again alike, whole and cut, from a call recorded in either format, of %s',
    (_case, answer) => {
      const kept = keptOf(answer);
      const whole = answeredWith({});
      const cut = answeredWith({ shown_bytes: Math.floor(bytesOf(resultText(answerOf(kept))) / 2) });

      expect([keptReply(whole, kept), keptReply(cut, kept)]).toEqual([
        keptReply({ ...whole, shown_format: shownFormat }, kept),
        keptReply({ ...cut, shown_format: shownFormat }, kept),
      ]);
    },
  );
});
