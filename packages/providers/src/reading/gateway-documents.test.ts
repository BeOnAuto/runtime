import { describe, expect, it } from 'vitest';

import { entryFolderWith } from '../testing/entry-problems.ts';

const entry = [
  'name: messages',
  'title: Messages',
  'description: Read and post the messages of a workspace.',
  'website: https://developer.messages.example.com',
  'type: openapi',
  'document: documents/messages.openapi.json',
  'credentials:',
  '  - kind: authorization',
  '    issuer: https://messages.example.com',
  '    gateway:',
  '      url: https://gateway.messages.example.com/connections',
  '      audiences:',
  '        connections: https://gateway.messages.example.com',
  '        calls: https://gateway.messages.example.com/api',
  '    in: security',
  '    name: connection_key',
  '',
].join('\n');

function documentWith(schemes: unknown): string {
  return JSON.stringify({
    openapi: '3.1.0',
    servers: [{ url: 'https://gateway.messages.example.com/api' }],
    paths: {},
    components: { securitySchemes: schemes },
  });
}

function readWith(schemes: unknown): Promise<string> {
  return entryFolderWith({ 'messages.yaml': entry, 'documents/messages.openapi.json': documentWith(schemes) }).read();
}

const refused =
  'The entries of the providers are invalid: <entries>/messages.yaml:16:11 credentials[0].name: Expected the name of a security scheme of the document, of type apiKey in a header other than Authorization, which the key a gateway hands over is sent under';

describe('the document beside an entry that connects through a gateway', () => {
  it('declares the scheme the key is sent under as a key in a header of its own', async () => {
    expect(await readWith({ connection_key: { type: 'apiKey', in: 'header', name: 'Connection-Key' } })).toBe(
      'messages https://gateway.messages.example.com/api',
    );
  });

  it('is refused where the scheme is missing, sends the key in a query, or is another type, which another header carries', async () => {
    expect(
      await Promise.all([
        readWith({ another: { type: 'apiKey', in: 'header', name: 'Connection-Key' } }),
        readWith({ connection_key: { type: 'apiKey', in: 'query', name: 'key' } }),
        readWith({ connection_key: { type: 'apiKey', in: 'header', name: 'AUTHORIZATION' } }),
        readWith({ connection_key: { type: 'apiKey', in: 'header' } }),
        readWith({ connection_key: { type: 'http', scheme: 'bearer' } }),
        readWith({ connection_key: { $ref: '#/components/securitySchemes/another' } }),
        entryFolderWith({
          'messages.yaml': entry,
          'documents/messages.openapi.json': JSON.stringify({
            openapi: '3.1.0',
            servers: [{ url: 'https://gateway.messages.example.com/api' }],
            paths: {},
          }),
        }).read(),
      ]),
    ).toEqual([refused, refused, refused, refused, refused, refused, refused]);
  });
});

describe('an entry that connects through a gateway with no document beside the entries', () => {
  it('is refused at its gateway, since nothing then says the header its key is sent in', async () => {
    const byItsAddress = entry.replace(
      'documents/messages.openapi.json',
      'https://gateway.messages.example.com/openapi.json',
    );

    expect(await entryFolderWith({ 'messages.yaml': byItsAddress }).read()).toBe(
      'The entries of the providers are invalid: <entries>/messages.yaml:11:7 credentials[0].gateway: Expected a document beside the entries, whose security scheme says the header the key a gateway hands over is sent in',
    );
  });
});
