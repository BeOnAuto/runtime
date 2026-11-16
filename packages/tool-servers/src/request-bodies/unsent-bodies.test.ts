import { describe, expect, it } from 'vitest';

import { of32, postTaking, reasonsOf } from '../api-testing/body-documents.ts';
import { documentOf, toolsOf } from '../api-testing/derived-documents.ts';

const referred = { $ref: '#/components/mediaTypes/Upload' };

describe('an operation of an HTTP API whose body the runtime does not send', () => {
  it('is a form encoded as a query, or may be a body of parts or another', () => {
    const document = documentOf({
      '/a': postTaking({ 'application/x-www-form-urlencoded': {} }),
      '/b': postTaking({ 'multipart/form-data': {}, 'application/octet-stream': {} }),
    });

    expect(reasonsOf(document)).toEqual([
      'its body is application/x-www-form-urlencoded, a form a call does not send',
      'its body may be multipart/form-data, application/octet-stream, and the document does not say which of them a call sends',
    ]);
  });

  it('refers to a media type under components, in its body or in a 2xx answer, which 3.2 allows and the runtime does not follow', () => {
    const document = documentOf(
      {
        '/a': postTaking({ 'text/plain': referred }),
        '/b': { post: { responses: { '201': { description: 'Made.', content: { 'application/json': referred } } } } },
        '/c': { post: { responses: { '400': { description: 'No.', content: { 'application/json': referred } } } } },
      },
      of32,
    );

    expect(reasonsOf(document)).toEqual([
      'its body refers to a media type under components, which the runtime does not follow',
      'its answer refers to a media type under components, which the runtime does not follow',
    ]);
  });
});

describe('an operation of OpenAPI 3.2 that a call does not send', () => {
  it('takes the whole query string as one parameter, is a QUERY, or is one of the additional operations of its path', () => {
    const { operations, leftOut } = toolsOf(
      documentOf(
        {
          '/a': {
            get: { parameters: [{ name: 'q', in: 'querystring', content: { 'text/plain': {} } }] },
            query: { operationId: 'search' },
            additionalOperations: { LINK: { operationId: 'link' }, COPY: {} },
          },
        },
        of32,
      ),
    );

    expect(operations).toEqual([]);
    expect(leftOut).toEqual([
      { operation: 'GET /a', because: 'its parameter q is the whole query string, which a call does not send' },
      { operation: 'search (QUERY /a)', because: 'a call does not send QUERY' },
      {
        operation: 'link (LINK /a)',
        because: 'a call does not send LINK, a method OpenAPI lists only among additional operations',
      },
      {
        operation: 'COPY /a',
        because: 'a call does not send COPY, a method OpenAPI lists only among additional operations',
      },
    ]);
  });
});
