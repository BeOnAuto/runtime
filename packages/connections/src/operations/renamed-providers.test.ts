import type { ProviderList } from '@on.auto/providers';
import { messagesThrough, providerListOf, providerOf } from '@on.auto/providers/testing';
import { shippedDocumentOf } from '@on.auto/tool-servers';
import { fakeApiDocument } from '@on.auto/tool-servers/testing';
import { describe, expect, it } from 'vitest';

import { added, reconnected } from '../testing/additions.ts';
import { askingThrough, toolsThrough } from '../testing/described-apis.ts';
import {
  allowedAt,
  connectedThrough,
  finishingWith,
  gatewayHarnessAt,
  gatewayServed,
  removing,
} from '../testing/gateways.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';
import { preparedOf, servedAs, sourceOver } from '../testing/served-connections.ts';

const server = 'https://api.notes.example.com/v1';

const documentText = JSON.stringify(fakeApiDocument('3.1', server));

const jottings = {
  name: 'jottings',
  title: 'Notes',
  description: 'Read and write the notes of a team.',
  website: 'https://developer.notes.example.com',
  type: 'openapi',
  document: 'documents/jottings.openapi.json',
  marks: { reads: ['addNote'] },
  renders: 'cards',
  credentials: [{ kind: 'none' }],
} as const;

const notes = { ...jottings, name: 'notes', document: 'documents/notes.openapi.json' } as const;

function listBeside(entry: Readonly<Record<string, unknown>>, written: string): ProviderList {
  return {
    ...providerListOf(providerOf(entry, server)),
    documents: new Map([[written, shippedDocumentOf(new TextEncoder().encode(documentText))]]),
  };
}

const named = listBeside(jottings, jottings.document);

const renamed = listBeside({ ...notes, aliases: ['jottings'] }, notes.document);

const renamedWithoutItsOldName = listBeside(notes, notes.document);

function under(h: Harness, providers: ProviderList): Harness {
  return { ...h, operations: h.operationsWith({ providers }) };
}

function listed(h: Harness): Promise<unknown> {
  return h.call(operationNamed(h.operations, 'list_connections'), ada);
}

async function providersAdded(h: Harness): Promise<readonly (string | null)[]> {
  return (await h.facts()).flatMap(({ type, data }) =>
    type === 'connection_added' && 'provider' in data ? [data.provider] : [],
  );
}

async function connectedBeside(): Promise<{ readonly h: Harness; readonly id: string }> {
  const h = harness({ providers: named });
  const { id, token } = await added(h, { provider: 'jottings' });
  await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });
  return { h, id };
}

describe('a connection added while its provider had another name', () => {
  it('is listed under the name its provider has now, its document the one beside the entries now, its own name kept', async () => {
    const { h } = await connectedBeside();

    expect(await listed(under(h, renamed))).toMatchObject({
      status: 'succeeded',
      output: {
        connections: [
          {
            name: 'jottings',
            provider: 'notes',
            entry: { document: 'documents/notes.openapi.json' },
            renders: 'cards',
            status: 'connected',
          },
        ],
      },
    });
    expect(await providersAdded(h)).toEqual(['jottings']);
  });

  it('is served under its provider’s name now, with its marks, its render target and its document read from beside the entries', async () => {
    const { h, id } = await connectedBeside();
    const source = sourceOver(h, { providers: renamed });

    expect((await servedAs(source, id)).serving).toMatchObject({
      name: 'jottings',
      provider: 'notes',
      renders: 'cards',
    });
    expect((await preparedOf(source, id)).settings).toMatchObject({
      name: 'jottings',
      provider: 'notes',
      marks: { reads: ['addNote'] },
      document: { kind: 'shipped', document: { text: documentText } },
    });
  });

  it('is read as it was recorded where no provider declares its old name', async () => {
    const { h, id } = await connectedBeside();

    expect(await listed(under(h, renamedWithoutItsOldName))).toMatchObject({
      output: { connections: [{ provider: 'jottings', entry: { document: 'documents/jottings.openapi.json' } }] },
    });
    expect((await servedAs(sourceOver(h, { providers: renamedWithoutItsOldName }), id)).serving).not.toHaveProperty(
      'renders',
    );
  });
});

function relayThrough(gateway: { readonly url: string; readonly document: string }): ProviderList {
  return providerListOf(
    providerOf({
      ...messagesThrough({ url: gateway.url, document: gateway.document }),
      name: 'relay',
      aliases: ['messages'],
    }),
  );
}

describe('a connection made through its gateway while its provider had another name', () => {
  it('is served under its provider’s name now, through that gateway with its key', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    const [key = ''] = gateway.keys();
    const providers = relayThrough(gateway);
    const tools = await toolsThrough(h, askingThrough(), { providers });

    const called = await tools.call('execute_connection', { server: 'messages', tool: 'who_am_i', arguments: {} });

    expect((await servedAs(sourceOver(h, { providers }), link.id)).serving).toMatchObject({
      name: 'messages',
      provider: 'relay',
    });
    expect(called).toMatchObject({ status: 'succeeded' });
    expect(gateway.seen().find(({ path }) => path === '/api/whoami')?.headers[gateway.keyHeader.toLowerCase()]).toBe(
      key,
    );
  });

  it('is reconnected through that gateway under its own name, recording no addition', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    const later = under(h, relayThrough(gateway));

    const relinked = await reconnected(later, link.id);
    const finished = await finishingWith(later, relinked, await allowedAt(later, gateway, relinked));

    expect(finished).toMatchObject({
      status: 'succeeded',
      output: { id: link.id, name: 'messages', provider: 'relay', status: 'connected' },
    });
    expect(await providersAdded(h)).toEqual(['messages']);
  });

  it('is removed with its key ended at that gateway', async () => {
    const gateway = await gatewayServed();
    const h = gatewayHarnessAt(gateway);
    const { link } = await connectedThrough(h, gateway);
    const [key = ''] = gateway.keys();

    const outcome = await removing(under(h, relayThrough(gateway)), link.id);

    expect(outcome).toMatchObject({ status: 'succeeded', output: { provider: 'relay', status: 'removed' } });
    expect(gateway.ended()).toEqual([key]);
  });
});
