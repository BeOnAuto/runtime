import { describe, expect, it } from 'vitest';

import { operationTaking, refusalOf, sentBy } from '../api-testing/body-documents.ts';

const anyType = operationTaking({ '*/*': {} });

const markupOnly = operationTaking({ 'text/markdown': {}, 'text/html': {} });

const takesText = 'and this operation takes a text there, alone or as { "media_type": …, "text": … }.';

describe('a text sent as the body of a call of an HTTP API, as it is', () => {
  it('is sent as its UTF-8 bytes in the one type the document declares, naming UTF-8 only for text', () => {
    expect(sentBy(operationTaking({ 'application/octet-stream': {} }), 'Grüße 🙂')).toEqual({
      type: 'application/octet-stream',
      text: 'Grüße 🙂',
    });
    expect(sentBy(operationTaking({ 'Text/CSV': {} }), 'a,b\n1,2')).toEqual({
      type: 'text/csv; charset=utf-8',
      text: 'a,b\n1,2',
    });
  });

  it('is sent as text/plain where the document declares any type, and a number or a yes or no as its text', () => {
    expect([sentBy(anyType, '# Notes'), sentBy(anyType, 7), sentBy(anyType, false)]).toEqual([
      { type: 'text/plain; charset=utf-8', text: '# Notes' },
      { type: 'text/plain; charset=utf-8', text: '7' },
      { type: 'text/plain; charset=utf-8', text: 'false' },
    ]);
  });
});

describe('a text sent as the body of a call of an HTTP API with its media type', () => {
  it('is sent in that type, compared without regard to case or parameters', () => {
    expect([
      sentBy(anyType, { media_type: 'text/markdown', text: '# Notes' }),
      sentBy(anyType, { media_type: 'application/vnd.example+json', text: '{"a":1}' }),
      sentBy(markupOnly, { media_type: 'Text/HTML; charset=latin1', text: '<p>Hi</p>' }),
      sentBy(operationTaking({ 'image/*': {} }), { media_type: 'image/svg+xml', text: '<svg/>' }),
    ]).toEqual([
      { type: 'text/markdown; charset=utf-8', text: '# Notes' },
      { type: 'application/vnd.example+json; charset=utf-8', text: '{"a":1}' },
      { type: 'text/html; charset=utf-8', text: '<p>Hi</p>' },
      { type: 'image/svg+xml', text: '<svg/>' },
    ]);
  });

  it('is refused unsent where the type is not one declared there, or is no media type at all', () => {
    expect([
      refusalOf(markupOnly, { media_type: 'text/csv', text: 'a,b' }),
      refusalOf(markupOnly, { media_type: 'markdown', text: '# Notes' }),
      refusalOf(markupOnly, { media_type: 'text/*', text: '# Notes' }),
      refusalOf(anyType, { media_type: 'text/plain\r\nX-Injected: 1', text: '' }),
    ]).toEqual([expect.any(String), expect.any(String), expect.any(String), expect.any(String)]);
  });
});

describe('a body of a call of an HTTP API that is neither a text nor a text with its media type', () => {
  it('is refused unsent, as is a bare text where the document declares no text/plain', () => {
    expect([
      refusalOf(markupOnly, '# Notes'),
      refusalOf(anyType, { media_type: 'text/plain', text: 'a', name: 'notes.txt' }),
      refusalOf(anyType, { media_type: 'text/plain', text: 7 }),
      refusalOf(anyType, ['a']),
      refusalOf(anyType, null),
    ]).toEqual([
      expect.any(String),
      `The argument /body is an object, ${takesText}`,
      `The argument /body is an object, ${takesText}`,
      `The argument /body is a list, ${takesText}`,
      `The argument /body is null, ${takesText}`,
    ]);
  });
});

describe('a JSON body of a call of an HTTP API that may also take a file', () => {
  it('is still sent as JSON in the type the document names', () => {
    expect(sentBy(operationTaking({ 'text/plain': {}, 'application/json': {} }), { a: 1 })).toEqual({
      type: 'application/json',
      text: '{"a":1}',
    });
  });
});
