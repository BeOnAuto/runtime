import { signInScopes } from '@on.auto/identity';
import { shippedFileIn, type ShippedFile, type ShippedFiles } from '@on.auto/shipped-files';
import { gatewayDocumentOf } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { accessTokenOf, issuerOverHttps } from '../sign-in/issuer-over-https.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const entries: ShippedFile = { package: '@on.auto/providers', path: 'src/entries' };

const gateway = 'https://gateway.messages.example.com';

const entry = [
  'name: messages',
  'title: Messages',
  'description: Read and post the messages of a workspace, as the app added to it.',
  'website: https://developer.messages.example.com',
  'type: openapi',
  'document: documents/messages.openapi.json',
  'credentials:',
  '  - kind: authorization',
  '    issuer: https://messages.example.com',
  '    gateway:',
  `      url: ${gateway}/connections`,
  '      audiences:',
  `        connections: ${gateway}`,
  `        calls: ${gateway}/api`,
  '    in: security',
  '    name: connection_key',
  '    description: Add the app to your workspace.',
  '',
].join('\n');

const shippedBeside: ReadonlyMap<string, string> = new Map([
  [shippedFileIn(entries, 'messages.yaml').path, entry],
  [
    shippedFileIn(entries, 'documents/messages.openapi.json').path,
    JSON.stringify(gatewayDocumentOf(gateway, 'Connection-Key')),
  ],
]);

function shippedBesideAt(file: ShippedFile): string | undefined {
  return file.package === entries.package ? shippedBeside.get(file.path) : undefined;
}

function isTheEntries(folder: ShippedFile): boolean {
  return folder.package === entries.package && folder.path === entries.path;
}

function shippedWithAnEntryThroughAGateway(files: ShippedFiles): ShippedFiles {
  return {
    text: (file) => {
      const text = shippedBesideAt(file);
      return text === undefined ? files.text(file) : Promise.resolve(text);
    },
    bytes: (file) => {
      const text = shippedBesideAt(file);
      return text === undefined ? files.bytes(file) : Promise.resolve(new TextEncoder().encode(text));
    },
    list: async (folder) =>
      isTheEntries(folder) ? [...(await files.list(folder)), 'messages.yaml'] : files.list(folder),
  };
}

const publicUrl = 'http://localhost:5555';

const notHere =
  "The provider messages connects through a service that Auto's cloud runs, which this runtime does not have";

const ListedSchema = Schema.Struct({
  providers: Schema.Array(Schema.Struct({ name: Schema.String, credentials: Schema.Array(Schema.Unknown) })),
});

interface Asking {
  readonly org: string;
  readonly token?: string;
}

async function servedWith(environment: Readonly<Record<string, string>>): Promise<ReasoningServer> {
  const server = await servingReasoning([], environment, undefined, {
    shippedFilesOver: shippedWithAnEntryThroughAGateway,
  });
  onTestFinished(server.stop);
  return server;
}

async function answeredFor(server: ReasoningServer, { org, token }: Asking) {
  const bearing = token === undefined ? {} : { key: token };
  const listed = await server.call('GET', `/v1/orgs/${org}/providers`, bearing);
  const added = await server.call('POST', `/v1/orgs/${org}/connections`, {
    ...bearing,
    body: { provider: 'messages' },
  });
  const kept = await server.call('GET', `/v1/orgs/${org}/connections`, bearing);
  const { providers } = Schema.decodeUnknownSync(ListedSchema)(listed.body);
  return {
    ways: providers.find(({ name }) => name === 'messages')?.credentials,
    added: { status: added.status, body: added.body },
    kept: kept.body,
  };
}

const refusedThroughAGateway = {
  ways: [{ kind: 'authorization', in: 'security', name: 'connection_key', offered: false, because: notHere }],
  added: { status: 422, body: { reason: 'invalid_input', errors: [{ pointer: '/provider', detail: notHere }] } },
  kept: { connections: [] },
};

describe('a provider whose shipped entry connects through a gateway, on the server a self-hosted or local runtime runs', () => {
  it('is listed as not offered, saying why, and its addition is refused at /provider with nothing recorded, by a server answering the local developer and one that signs people in alike', async () => {
    const issuer = await issuerOverHttps();
    const local = await servedWith({});
    const signingIn = await servedWith({ IDENTITY_ISSUER: issuer.issuer, PUBLIC_URL: publicUrl });
    const person = await accessTokenOf(issuer, publicUrl, signInScopes.join(' '));

    const answered = [
      await answeredFor(local, { org: 'local' }),
      await answeredFor(signingIn, { org: 'acme', token: person }),
    ];

    expect(answered).toMatchObject([refusedThroughAGateway, refusedThroughAGateway]);
  });
});
