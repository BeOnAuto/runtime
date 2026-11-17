import { Buffer } from 'node:buffer';

import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { boundaryOf, framedWith, of32, operationTaking } from '../api-testing/body-documents.ts';
import { apiRequestOf, sentBodyOf, type ApiEndpoint } from '../openapi/api-requests.ts';
import type { ApiOperation } from '../openapi/api-tools.ts';
import { heldForATest, keptForATest } from '../testing/held-assets.ts';
import { plannedAssets } from './planned-assets.ts';

const endpoint: ApiEndpoint = { baseUrl: 'https://files.example.com', headers: new Map(), query: new Map() };

const photo = keptForATest('asset-photo', 'image/png', Uint8Array.of(137, 80, 78, 71));

const page = keptForATest('asset-page', 'text/plain', 'Été, done\n');

const json = 'Content-Type: application/json; charset=utf-8';

const plainText = 'Content-Type: text/plain; charset=utf-8';

const related = operationTaking(
  {
    'multipart/related': {
      schema: {
        type: 'array',
        prefixItems: [
          { type: 'object', properties: { name: { type: 'string' }, thumbnail: { type: 'string', format: 'byte' } } },
          {},
        ],
        minItems: 2,
        items: false,
      },
      prefixEncoding: [{ contentType: 'application/json' }, { contentType: '*/*' }],
    },
  },
  of32,
);

const form = operationTaking({
  'multipart/form-data': {
    schema: {
      type: 'object',
      properties: {
        meta: { type: 'object', properties: { thumbnail: { type: 'string', contentEncoding: 'base64' } } },
        note: { type: 'string' },
      },
    },
  },
});

const whole = operationTaking({ 'text/plain': { schema: { type: 'string' } } });

async function requestOf(operation: ApiOperation, body: unknown) {
  const input = { body };
  const { sent } = await Effect.runPromise(
    plannedAssets(input, {
      holding: heldForATest([photo, page]),
      playbook: { org: 'acme', playbook: 'alpha' },
      inputSchema: operation.tool.inputSchema,
      tool: 'the put tool of files',
      mostBytes: 1_048_576,
    }),
  );
  return apiRequestOf(operation, input, endpoint, sent);
}

async function sentOf(operation: ApiOperation, body: unknown) {
  const request = Result.getOrThrow(await requestOf(operation, body));
  const { headers, body: sent } = sentBodyOf(request, request.headers);
  return { type: headers['content-type'], length: headers['content-length'], text: await new Response(sent).text() };
}

async function refusalOf(operation: ApiOperation, body: unknown): Promise<string> {
  return Result.getOrThrow(Result.flip(await requestOf(operation, body)));
}

describe('an asset in a body of parts', () => {
  it('is written where a part is JSON, as the schema of that part declares, at the length it is sent', async () => {
    const ordered = await sentOf(related, [{ name: 'photo.png', thumbnail: photo.reference }, 'A caption']);
    const named = await sentOf(form, { meta: { thumbnail: photo.reference }, note: 'Hi' });
    const orderedText = framedWith(boundaryOf(ordered.type), [
      [[json], '{"name":"photo.png","thumbnail":"iVBORw=="}'],
      [[plainText], 'A caption'],
    ]);
    const namedText = framedWith(boundaryOf(named.type), [
      [['Content-Disposition: form-data; name="meta"', json], '{"thumbnail":"iVBORw=="}'],
      [['Content-Disposition: form-data; name="note"', plainText], 'Hi'],
    ]);

    expect([
      { length: ordered.length, text: ordered.text },
      { length: named.length, text: named.text },
    ]).toEqual([
      { length: String(Buffer.byteLength(orderedText)), text: orderedText },
      { length: String(Buffer.byteLength(namedText)), text: namedText },
    ]);
  });

  it('is not sent where a part, or the whole body, is a text, and the call is refused as for any object there', async () => {
    expect(
      await Promise.all([
        refusalOf(related, [{ name: 'notes.md' }, page.reference]),
        refusalOf(related, [{ name: 'notes.md' }, 'A caption', page.reference]),
        refusalOf(form, { note: page.reference }),
        refusalOf(form, { other: page.reference }),
        refusalOf(whole, page.reference),
      ]),
    ).toEqual([
      'The argument /body/1 is an object, and this operation takes a text there, alone or as { "media_type": …, "text": … }.',
      'The argument /body holds 3 parts, and this operation takes at most 2; leave out the parts past those',
      'The argument /body/note is an object, and this operation takes a text there, alone or as { "media_type": …, "text": … }.',
      'The argument /body/other names no part of the body of this operation',
      'The argument /body is an object, and this operation takes a text there, alone or as { "media_type": …, "text": … }.',
    ]);
  });
});
