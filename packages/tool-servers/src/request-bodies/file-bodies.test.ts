import { describe, expect, it } from 'vitest';

import {
  bodyOfTheTool,
  plainTextMember,
  postTaking,
  posting,
  reasonsOf,
  textWithItsType,
} from '../api-testing/body-documents.ts';
import { documentOf, toolNamed } from '../api-testing/derived-documents.ts';

describe('an operation of an HTTP API whose body is a file of one type', () => {
  it('is offered as a tool that acts, its body a text sent in that type, described so where its schema says nothing', () => {
    const tool = toolNamed(documentOf(posting({ 'application/octet-stream': {} })), 'put');

    expect(tool?.inputSchema).toEqual({
      type: 'object',
      properties: { body: { type: 'string', description: 'A text, sent as application/octet-stream.' } },
      required: ['body'],
      additionalProperties: false,
    });
    expect(tool?.annotations).toEqual({ readOnlyHint: false, openWorldHint: true });
  });

  it('keeps the schema the document writes for that type where it is a text, and says the type it is sent as', () => {
    const rows = { type: 'string', description: 'The rows, one a line.' };
    const count = { type: 'integer', minimum: 1, description: 'How many' };

    expect(bodyOfTheTool(documentOf(posting({ 'text/csv': { schema: rows } })))).toEqual({
      type: 'string',
      description: 'The rows, one a line. A text, sent as text/csv.',
    });
    expect(bodyOfTheTool(documentOf(posting({ 'text/plain': { schema: count } })))).toEqual({
      type: 'integer',
      minimum: 1,
      description: 'How many. A text, sent as text/plain.',
    });
  });
});

describe('an operation of an HTTP API whose body is a file of one type, its schema not a text', () => {
  it("takes a text, with the document's description, since the bridge sends a text there and nothing else", () => {
    const xml = { type: 'object', description: 'The order.', properties: { id: { type: 'string' } } };

    expect(bodyOfTheTool(documentOf(posting({ 'application/xml': { schema: xml } })))).toEqual({
      type: 'string',
      description: 'The order. A text, sent as application/xml.',
    });
    expect(bodyOfTheTool(documentOf(posting({ 'text/csv': { schema: { type: ['string', 'null'] } } })))).toEqual({
      type: 'string',
      description: 'A text, sent as text/csv.',
    });
    expect(bodyOfTheTool(documentOf(posting({ 'text/csv': { schema: { description: ' ' } } })))).toEqual({
      type: 'string',
      description: 'A text, sent as text/csv.',
    });
  });
});

describe('an operation of an HTTP API whose body is a file of any type, or of a range', () => {
  it('takes a text, or a text with its media type, where a range holds text/plain, keeping the description', () => {
    expect(bodyOfTheTool(documentOf(posting({ '*/*': {} })))).toEqual({ anyOf: [plainTextMember, textWithItsType()] });
    expect(bodyOfTheTool(documentOf(posting({ 'text/*': { schema: { description: 'A page.' } } })))).toEqual({
      description: 'A page.',
      anyOf: [plainTextMember, textWithItsType()],
    });
  });

  it('takes only a text with its media type, listed, where none of the types is text/plain', () => {
    expect(bodyOfTheTool(documentOf(posting({ 'text/markdown': {}, 'Text/HTML; charset=utf-8': {} })))).toEqual(
      textWithItsType(['text/markdown', 'text/html']),
    );
  });
});

describe('an operation of an HTTP API whose body is a file it cannot send', () => {
  it('declares a type that is not a media type', () => {
    expect(reasonsOf(documentOf(posting({ markdown: {} })))).toEqual([
      'its body is markdown, which is not a media type',
    ]);
  });

  it('is a GET, which carries no body, or shares the name of its body with a parameter', () => {
    const document = documentOf({
      '/a': { get: { requestBody: { content: { 'text/plain': {} } } } },
      '/b': postTaking({ 'text/plain': {} }, { parameters: [{ name: 'body', in: 'query' }] }),
    });

    expect(reasonsOf(document)).toEqual([
      'it takes a body, which a GET cannot carry',
      'two of its inputs are named body',
    ]);
  });
});

describe('an operation of an HTTP API whose body may be JSON or a file', () => {
  it('is offered with its JSON body, as it always was', () => {
    const document = documentOf(posting({ 'text/plain': {}, 'application/json': { schema: { type: 'object' } } }));

    expect(bodyOfTheTool(document)).toEqual({ type: 'object' });
  });
});
