import { describe, expect, it } from 'vitest';

import {
  bodyOfTheTool,
  of32,
  plainTextMember,
  posting,
  reasonsOf,
  relatedTaking,
  textWithItsType,
} from '../api-testing/body-documents.ts';
import { documentOf, toolNamed } from '../api-testing/derived-documents.ts';

const ordered = {
  'multipart/related': {
    schema: {
      type: 'array',
      description: 'The file.',
      prefixItems: [{ $ref: '#/components/schemas/File' }, {}],
      minItems: 2,
      items: false,
    },
    prefixEncoding: [{ contentType: 'application/json' }, { contentType: '*/*' }],
  },
};

const octetStreamText = { type: 'string', description: 'A text, sent as application/octet-stream.' };

const unsaid = 'its body is multipart/related, and the document does not say what each of its parts is';

describe('an operation of an HTTP API whose body is parts in an order of OpenAPI 3.2', () => {
  it('takes a list of its parts, in order, the first JSON and the second a text, and no part more', () => {
    const document = documentOf(posting(ordered), {
      ...of32,
      components: { schemas: { File: { type: 'object', properties: { name: { type: 'string' } } } } },
    });

    expect(toolNamed(document, 'put')?.inputSchema).toEqual({
      type: 'object',
      properties: {
        body: {
          type: 'array',
          description: 'The file.',
          prefixItems: [{ $ref: '#/$defs/File' }, { anyOf: [plainTextMember, textWithItsType()] }],
          minItems: 2,
          items: false,
        },
      },
      required: ['body'],
      additionalProperties: false,
      $defs: { File: { type: 'object', properties: { name: { type: 'string' } } } },
    });
  });

  it('gives a part with no Encoding Object, and every part past those the schema lists, the encoding its schema gives', () => {
    const mixed = {
      'multipart/mixed': {
        schema: { type: 'array', prefixItems: [{ type: 'object' }, {}, { type: 'string' }], maxItems: 5 },
        prefixEncoding: [{ style: 'form' }],
      },
    };

    expect(bodyOfTheTool(documentOf(posting(mixed), of32))).toEqual({
      type: 'array',
      prefixItems: [
        { type: 'object' },
        octetStreamText,
        { type: 'string', description: 'A text, sent as text/plain.' },
      ],
      maxItems: 5,
      items: octetStreamText,
    });
  });
});

describe('the parts past those an ordered body lists', () => {
  it('take the schema of items, and the encoding it gives, where the document writes one', () => {
    const listed = {
      'multipart/mixed': { schema: { type: 'array', items: { type: 'object' } }, prefixEncoding: [{}] },
    };

    expect(bodyOfTheTool(documentOf(posting(listed), of32))).toEqual({
      type: 'array',
      prefixItems: [octetStreamText],
      items: { type: 'object' },
    });
  });
});

describe('an operation of an HTTP API whose parts in an order the document does not say', () => {
  it('is left out from a document of 3.1, which cannot say an order of parts', () => {
    expect(reasonsOf(documentOf(posting(ordered)))).toEqual([unsaid]);
  });

  it('is left out from a document of 3.2 without an encoding by position over an array schema', () => {
    const document = documentOf(
      {
        '/a': relatedTaking({ schema: { type: 'array' }, encoding: {} }),
        '/b': relatedTaking({ schema: { type: 'array', prefixItems: {} }, prefixEncoding: [{}] }),
        '/c': relatedTaking({ prefixEncoding: [{}] }),
      },
      of32,
    );

    expect(reasonsOf(document)).toEqual([unsaid, unsaid, unsaid]);
  });

  it('is left out where parts past those encoded are described alone, or a part needs a header', () => {
    const document = documentOf(
      {
        '/d': relatedTaking({ schema: { type: 'array', prefixItems: [] }, prefixEncoding: [{}], itemEncoding: {} }),
        '/e': relatedTaking({
          schema: { type: 'array', prefixItems: [] },
          prefixEncoding: [{}, { headers: { 'Content-Location': { required: true } } }],
        }),
        '/f': relatedTaking({
          schema: { type: 'array', items: { type: 'string', contentEncoding: 'base64' } },
          prefixEncoding: [{}],
        }),
      },
      of32,
    );

    expect(reasonsOf(document)).toEqual([
      'its body is multipart/related, whose parts the document describes by itemEncoding or itemSchema, which a call does not send',
      'its part 2 needs the header Content-Location, which a call does not send',
      'its part after 1 is written in base64, which a call does not send',
    ]);
  });
});

describe('an operation of an HTTP API whose ordered body no list of parts can meet', () => {
  it('is left out where its document asks for more parts than it takes', () => {
    const document = documentOf(
      {
        '/a': relatedTaking({
          schema: { type: 'array', prefixItems: [{}], minItems: 3, items: false },
          prefixEncoding: [{}],
        }),
        '/b': relatedTaking({ schema: { type: 'array', minItems: 4, maxItems: 2 }, prefixEncoding: [{}] }),
      },
      of32,
    );

    expect(reasonsOf(document)).toEqual([
      'its body is multipart/related, and its document asks for at least 3 parts where it takes at most 1',
      'its body is multipart/related, and its document asks for at least 4 parts where it takes at most 2',
    ]);
  });
});
