import { describe, expect, it } from 'vitest';

import { answering, delivering, documentOf, problemsOf, reading, replacing } from '../testing/route-documents.ts';

const deliveryNames = 'input, today, now, to, message, run_id, function, expires_at and answer_schema';

function deliveringText(text: string): readonly string[] {
  return replacing(delivering, "    text: '{{ message }}'", `    text: '${text}'`);
}

describe('the templates of a delivery', () => {
  it('refuse a name a delivery does not have, a template that does not compile, and a ${', () => {
    expect([
      problemsOf(documentOf(deliveringText('{{ party }}'))),
      problemsOf(documentOf(deliveringText('{{ message'))),
      problemsOf(documentOf(deliveringText('Bearer ${CHAT_KEY}'))),
    ]).toEqual([
      [
        `Line 9, /deliver/with/text: Reads party, which a template of a delivery does not have; it reads ${deliveryNames}`,
      ],
      [expect.stringMatching(/^Line 9, \/deliver\/with\/text: /u)],
      ['Line 9, /deliver/with/text: Expected no ${ in a template, which never holds a secret'],
    ]);
    expect(problemsOf(documentOf(deliveringText('{{ to }}'.repeat(1100))))).toEqual([
      expect.stringContaining('A template may use at most 1000 names'),
    ]);
  });

  it('refuse a property of the input its closed schema does not have, and the moments read as objects', () => {
    const closed = [
      'input:',
      '  schema: { type: object, additionalProperties: false, properties: { owner: { type: string } } }',
    ];

    expect([
      problemsOf(documentOf(deliveringText('{{ input.missing }}'), closed)),
      problemsOf(documentOf(deliveringText('{{ today.year }}'))),
    ]).toEqual([
      [
        'Line 9, /deliver/with/text: input.missing is not a property of the input schema, which allows no others',
        expect.stringContaining('input.campaign is not a property'),
      ],
      ['Line 9, /deliver/with/text: today is the date, as YYYY-MM-DD, and has no properties'],
    ]);
  });
});

describe('a delivery argument and the values it holds', () => {
  it('refuse a structure inside a longer text, and take one written | json, one alone, or one that reads the input', () => {
    expect([
      problemsOf(documentOf(deliveringText('Schema: {{ answer_schema }}'))),
      problemsOf(documentOf(deliveringText('Schema: {{ answer_schema | json }}'))),
      problemsOf(documentOf(deliveringText('{{ answer_schema }}'))),
      problemsOf(documentOf(deliveringText('Input: {{ input }}'))),
    ]).toEqual([
      [
        'Line 9, /deliver/with/text: Renders a value that is not text among text; write | json after it, or write it alone as one {{ }} to send it as it is',
      ],
      [],
      [],
      [],
    ]);
  });

  it('check every string within a value written as a number, a list or an object, at its own path', () => {
    const typed = replacing(
      delivering,
      "    text: '{{ message }}'",
      "    limit: 20\n    blocks:\n      - type: section\n        text: 'Hello {{ party }}'",
    );

    expect(problemsOf(documentOf(typed))).toEqual([
      `Line 12, /deliver/with/blocks/0/text: Reads party, which a template of a delivery does not have; it reads ${deliveryNames}`,
    ]);
  });
});

describe('the templates of a reading and a telling', () => {
  it('refuse a name each does not have, with the names each reads', () => {
    const keyed = replacing(
      reading,
      "  conversation: '{{ sent.conversation }}/{{ sent.id }}'",
      "  conversation: '{{ since }}'",
    );
    const readWith = replacing(reading, "    ts: '{{ sent.id }}'", "    ts: '{{ sent.thread }}'");
    const told = replacing(reading, "      text: '{{ message }}'", "      text: '{{ since }}'");

    expect([
      problemsOf(documentOf(delivering, keyed, answering)),
      problemsOf(documentOf(delivering, readWith, answering)),
      problemsOf(documentOf(delivering, told, answering)),
    ]).toEqual([
      [
        'Line 14, /replies/conversation: Reads since, which the conversation key of a reading does not have; it reads to, sent.conversation and sent.id',
      ],
      [
        'Line 18, /replies/with/ts: Reads sent.thread, which a template of a reading does not have; it reads to, sent.conversation, sent.id, conversation and since',
      ],
      [
        'Line 30, /replies/tell/with/text: Reads since, which a template of a telling does not have; it reads to, sent.conversation, sent.id and message',
      ],
    ]);
  });
});

describe('the values a reading and a telling send', () => {
  it('refuse a structure inside a longer text, and a conversation key that is not text', () => {
    const inText = replacing(reading, "    ts: '{{ sent.id }}'", "    ts: 'At {{ sent }}'");
    const alone = replacing(reading, "    ts: '{{ sent.id }}'", "    ts: '{{ sent }}'");
    const keyed = replacing(
      reading,
      "  conversation: '{{ sent.conversation }}/{{ sent.id }}'",
      "  conversation: '{{ sent }}'",
    );

    expect([
      problemsOf(documentOf(delivering, inText, answering)),
      problemsOf(documentOf(delivering, alone, answering)),
      problemsOf(documentOf(delivering, keyed, answering)),
    ]).toEqual([
      [
        'Line 18, /replies/with/ts: Renders a value that is not text among text; write | json after it, or write it alone as one {{ }} to send it as it is',
      ],
      [],
      [
        'Line 14, /replies/conversation: Renders a value that is not text; write | json after a structured value such as sent',
      ],
    ]);
  });
});
