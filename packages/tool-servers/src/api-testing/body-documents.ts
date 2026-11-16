import { Option, Result, type Schema } from 'effect';

import { apiRequestOf, type ApiEndpoint, type ApiRequest } from '../openapi/api-requests.ts';
import type { ApiOperation } from '../openapi/api-tools.ts';
import { documentOf, toolNamed, toolsOf } from './derived-documents.ts';

type Fields = Readonly<Record<string, Schema.Json>>;

interface Sent {
  readonly type: string | undefined;
  readonly text: string;
}

export const of32: Fields = { openapi: '3.2.0' };

export const plainTextMember = { type: 'string', description: 'A text, sent as text/plain.' };

const endpoint: ApiEndpoint = { baseUrl: 'https://files.example.com', headers: new Map(), query: new Map() };

const decoder = new TextDecoder();

export function postTaking(content: Fields, more: Fields = {}): Schema.JsonObject {
  return { post: { operationId: 'put', requestBody: { required: true, content }, ...more } };
}

export function posting(content: Fields, more: Fields = {}): Fields {
  return { '/files': postTaking(content, more) };
}

export function formTaking(property: Schema.Json, encoding?: Schema.Json): Schema.JsonObject {
  return postTaking({
    'multipart/form-data': {
      schema: { type: 'object', properties: { part: property } },
      ...(encoding === undefined ? {} : { encoding: { part: encoding } }),
    },
  });
}

export function relatedTaking(media: Fields): Schema.JsonObject {
  return postTaking({ 'multipart/related': media });
}

export function bodyOfTheTool(document: Fields): unknown {
  return Reflect.get(new Object(toolNamed(document, 'put')?.inputSchema['properties']), 'body');
}

export function reasonsOf(document: Fields): readonly string[] {
  return toolsOf(document).leftOut.map(({ because }) => because);
}

export function textWithItsType(listed?: readonly string[]): Schema.JsonObject {
  return {
    type: 'object',
    description: 'A text with its media type.',
    properties: {
      media_type: {
        type: 'string',
        description: 'What the text is, as a media type.',
        ...(listed === undefined ? {} : { enum: listed }),
      },
      text: { type: 'string' },
    },
    required: ['media_type', 'text'],
    additionalProperties: false,
  };
}

export function operationTaking(content: Fields, more: Fields = {}): ApiOperation {
  const document = documentOf({ '/files': { post: { operationId: 'put', requestBody: { content } } } }, more);
  return Option.getOrThrow(Option.fromNullishOr(toolsOf(document).operations[0]));
}

function textOf(content: ApiRequest['body']): string {
  return content instanceof Uint8Array ? decoder.decode(content) : String(content);
}

export function sentBy(operation: ApiOperation, body: unknown): Sent {
  const { headers, body: content } = Result.getOrThrow(apiRequestOf(operation, { body }, endpoint));
  return { type: headers['content-type'], text: textOf(content) };
}

export function refusalOf(operation: ApiOperation, body: unknown): string {
  return Result.getOrThrow(Result.flip(apiRequestOf(operation, { body }, endpoint)));
}

export function framedWith(boundary: string, parts: readonly (readonly [readonly string[], string])[]): string {
  const framed = parts.map(([headers, text]) => `--${boundary}\r\n${headers.join('\r\n')}\r\n\r\n${text}\r\n`);
  return `${framed.join('')}--${boundary}--\r\n`;
}

export function boundaryOf(type: string | undefined): string {
  return String(type).replace(/^.*; boundary=/u, '');
}
