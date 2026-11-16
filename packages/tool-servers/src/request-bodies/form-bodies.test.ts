import { describe, expect, it } from 'vitest';

import { bodyOfTheTool, formTaking, postTaking, posting, reasonsOf } from '../api-testing/body-documents.ts';
import { documentOf, toolNamed } from '../api-testing/derived-documents.ts';

const upload = {
  type: 'object',
  description: 'The upload.',
  properties: {
    title: { type: 'string', description: 'The title.' },
    count: { type: ['integer', 7, 'file', 'null'] },
    meta: { $ref: '#/components/schemas/Meta' },
    labels: { type: 'string' },
  },
  required: ['title', 'missing'],
};

const encodedUpload = {
  'multipart/form-data': {
    schema: { $ref: '#/components/schemas/Upload' },
    encoding: { labels: { contentType: 'application/json' }, unknown: { contentType: 'image/png' } },
  },
};

const fileOf = (part: string) =>
  `its part ${part} is a file, which a form sends with a file name, and a call cannot give one`;

describe('an operation of an HTTP API whose body is a form of fields', () => {
  it('takes an object of its fields by name, each a text or JSON as its encoding or its schema says', () => {
    const document = documentOf(posting(encodedUpload), {
      components: { schemas: { Upload: upload, Meta: { type: 'object' } } },
    });

    expect(toolNamed(document, 'put')?.inputSchema['properties']).toEqual({
      body: {
        type: 'object',
        description: 'The upload.',
        properties: {
          title: { type: 'string', description: 'The title.' },
          count: { type: ['integer', 7, 'file', 'null'] },
          meta: { $ref: '#/$defs/Meta' },
          labels: { type: 'string' },
        },
        required: ['title'],
        additionalProperties: false,
      },
    });
  });
});

describe('an operation of an HTTP API whose form has a file', () => {
  it('is left out, since a form names a file and a call has no name to give it, however the document marks the file', () => {
    const document = documentOf({
      '/a': formTaking({}),
      '/b': formTaking({ type: 'string', contentMediaType: 'image/png' }),
      '/c': formTaking({ type: 'string' }, { contentType: 'text/csv' }),
      '/d': formTaking({ type: 'string' }, { contentType: 'text/plain' }),
    });
    const in30 = {
      ...documentOf(
        posting({
          'multipart/form-data': {
            schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
          },
        }),
      ),
      openapi: '3.0.3',
    };

    expect(reasonsOf(document)).toEqual([fileOf('part'), fileOf('part'), fileOf('part'), fileOf('part')]);
    expect(reasonsOf(in30)).toEqual([fileOf('file')]);
  });
});

describe('an operation of an HTTP API whose form has a part it cannot send', () => {
  it('is left out where a part is a list, styled as a query, or encoded', () => {
    const document = documentOf({
      '/a': formTaking({ type: 'array' }),
      '/b': formTaking({ type: 'string' }, { style: 'form' }),
      '/c': formTaking({ type: 'string' }, { explode: true }),
      '/d': formTaking({ type: 'string', contentEncoding: 'base64' }),
    });

    expect(reasonsOf(document)).toEqual([
      'its part part is a list of parts, which a call does not send',
      'its part part is written with style, explode or allowReserved, a form a call does not send',
      'its part part is written with style, explode or allowReserved, a form a call does not send',
      'its part part is written in base64, which a call does not send',
    ]);
  });

  it('is left out where a part needs a header, is a body of parts itself, or is of no type it can name', () => {
    const document = documentOf({
      '/e': formTaking({}, { headers: { 'Content-Type': { required: true }, 'X-Part': { required: true } } }),
      '/f': formTaking({}, { headers: { 'X-Part': { $ref: '#/components/headers/Part' } } }),
      '/g': formTaking({}, { prefixEncoding: [] }),
      '/h': formTaking({}, { contentType: 'csv' }),
      '/i': formTaking({ type: ['string', 'object'] }),
      '/j': formTaking({ type: 'string' }, { headers: { 'X-Part': { required: false } } }),
    });

    expect(reasonsOf(document)).toEqual([
      'its part part needs the header X-Part, which a call does not send',
      'its part part needs the header X-Part, which a call does not send',
      'its part part is itself a body of parts, which a call does not send',
      'its part part takes csv, which is not a media type',
      'its part part may be of several types, and the document does not say which',
    ]);
  });
});

describe('an operation of an HTTP API whose form the document does not describe by name', () => {
  it('is left out where the document does not say its parts, or says them by position', () => {
    const document = documentOf({
      '/a': postTaking({ 'multipart/form-data': { schema: { type: 'object' } } }),
      '/b': postTaking({ 'multipart/form-data': {} }),
      '/c': postTaking({ 'multipart/form-data': { schema: { type: 'array' }, prefixEncoding: [{}] } }),
      '/d': postTaking({ 'multipart/form-data': { itemSchema: {} } }),
    });

    expect(reasonsOf(document)).toEqual([
      'its body is multipart/form-data, and the document does not say what each of its parts is',
      'its body is multipart/form-data, and the document does not say what each of its parts is',
      'its body is multipart/form-data, whose parts the document describes by position, which a call does not send',
      'its body is multipart/form-data, whose parts the document describes by position, which a call does not send',
    ]);
  });
});

describe('a text field of a form', () => {
  it('keeps the schema the document writes for it, as the bridge sends what it takes as text', () => {
    const fields = {
      'multipart/form-data': { schema: { type: 'object', properties: { note: { type: 'number', maximum: 9 } } } },
    };

    expect(bodyOfTheTool(documentOf(posting(fields)))).toEqual({
      type: 'object',
      properties: { note: { type: 'number', maximum: 9 } },
      additionalProperties: false,
    });
  });
});
