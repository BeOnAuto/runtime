import { describe, expect, it } from 'vitest';

import { boundaryOf, framedWith, of32, operationTaking, refusalOf, sentBy } from '../api-testing/body-documents.ts';

const related = operationTaking(
  {
    'Multipart/Related': {
      schema: { type: 'array', prefixItems: [{ type: 'object' }, {}], minItems: 2, items: false },
      prefixEncoding: [{}, { contentType: '*/*' }],
    },
  },
  of32,
);

const open = operationTaking(
  {
    'multipart/mixed': {
      schema: { type: 'array', prefixItems: [{ type: 'object' }], maxItems: 3 },
      prefixEncoding: [{}],
    },
  },
  of32,
);

const form = operationTaking({
  'multipart/form-data': {
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        'say "hi"\r\n': { type: 'string' },
        meta: { type: 'object' },
        skipped: {},
      },
    },
    encoding: { skipped: { contentType: 'application/json' } },
  },
});

const metadata = { name: 'Weekly report.md', parents: ['folder-1'] };

const json = 'Content-Type: application/json; charset=utf-8';

describe('a body of parts in an order sent by a call of an HTTP API', () => {
  it('frames each part with its type, JSON first and the text after, under a boundary of its own each time', () => {
    const { type, text } = sentBy(related, [metadata, { media_type: 'text/markdown', text: '# Week\r\n\r\nDone.' }]);
    const boundary = boundaryOf(type);

    expect(type).toMatch(/^multipart\/related; boundary=auto-[\da-f-]{36}$/u);
    expect(text).toBe(
      framedWith(boundary, [
        [[json], JSON.stringify(metadata)],
        [['Content-Type: text/markdown; charset=utf-8'], '# Week\r\n\r\nDone.'],
      ]),
    );
    expect(boundaryOf(sentBy(related, [metadata, 'Again.']).type)).not.toBe(boundary);
  });

  it('sends the parts past those the schema lists in the encoding the schema gives them, up to the most it takes', () => {
    const { type, text } = sentBy(open, [{ a: 1 }, 'b', 'c']);

    expect(text).toBe(
      framedWith(boundaryOf(type), [
        [[json], '{"a":1}'],
        [['Content-Type: application/octet-stream'], 'b'],
        [['Content-Type: application/octet-stream'], 'c'],
      ]),
    );
  });
});

describe('a body of parts in an order that a call of an HTTP API cannot send', () => {
  it('holds fewer parts than the operation takes, or more, and the words say what to give', () => {
    expect([
      refusalOf(related, [metadata]),
      refusalOf(related, [{}, 'a', 'b']),
      refusalOf(open, [{}, 'a', 'b', 'c']),
    ]).toEqual([
      'The argument /body holds 1 part, and this operation takes at least 2; give every part its input_schema lists, in order',
      'The argument /body holds 3 parts, and this operation takes at most 2; leave out the parts past those',
      'The argument /body holds 4 parts, and this operation takes at most 3; leave out the parts past those',
    ]);
  });

  it('is not a list, holds no part, or holds a part of a type not declared', () => {
    expect([
      refusalOf(related, { name: 'a' }),
      refusalOf(open, []),
      refusalOf(related, [{}, { media_type: 'csv', text: 'a' }]),
    ]).toEqual([
      'The argument /body is not a list, and this operation takes its parts as a list, one item per part, in order',
      'The argument /body gives no part, and a body of parts needs one at least',
      'The argument /body/1 gives the media type csv, and this operation takes */* there; give one of those.',
    ]);
  });
});

describe('a form of fields sent by a call of an HTTP API', () => {
  it('frames each field under its name, written so no name breaks out of its header, and leaves out a field given null', () => {
    const { type, text } = sentBy(form, { title: 'Notes', 'say "hi"\r\n': 7, meta: { tags: ['a'] }, skipped: null });

    expect(type).toMatch(/^multipart\/form-data; boundary=auto-/u);
    expect(text).toBe(
      framedWith(boundaryOf(type), [
        [['Content-Disposition: form-data; name="title"', 'Content-Type: text/plain; charset=utf-8'], 'Notes'],
        [['Content-Disposition: form-data; name="say %22hi%22%0D%0A"', 'Content-Type: text/plain; charset=utf-8'], '7'],
        [['Content-Disposition: form-data; name="meta"', json], '{"tags":["a"]}'],
      ]),
    );
  });
});

describe('a form of fields that a call of an HTTP API cannot send', () => {
  it('is not an object, names a property that is no field, holds a field it cannot send, or gives no field', () => {
    expect([
      refusalOf(form, ['Notes']),
      refusalOf(form, { title: 'Notes', colour: 'red' }),
      refusalOf(form, { title: { text: 'Notes' } }),
      refusalOf(form, { skipped: null }),
    ]).toEqual([
      'The argument /body is not an object, and this operation takes its parts as an object, one property per part',
      'The argument /body/colour names no part of the body of this operation',
      'The argument /body/title is an object, and this operation takes a text there, alone or as { "media_type": …, "text": … }.',
      'The argument /body gives no part, and a body of parts needs one at least',
    ]);
  });
});
