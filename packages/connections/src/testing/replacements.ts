import { messagesThrough, providerListOf, providerOf } from '@on.auto/providers/testing';
import type { FakeGateway } from '@on.auto/tool-servers/served-fakes';
import { registeredAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { onTestFinished } from 'vitest';

import type { ConnectionOperations } from '../operations/connection-operations.ts';
import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added, type Added } from './additions.ts';
import { connectedThrough, consentFake, filesAt, sharingWay } from './consents.ts';
import { gatewayServed } from './gateways.ts';
import { harness, type Harness } from './harness.ts';

export const replacingPolicy = connectionPolicyOf({ allowed_hosts: ['127.0.0.1', 'messages.example.com'] });

type Provider = ReturnType<typeof providerOf>;

type ProviderList = ReturnType<typeof providerListOf>;

type EntryChanges = Readonly<Record<string, unknown>>;

export interface Replacing {
  readonly files: FakeMcpServer;
  readonly gateway: FakeGateway;
  readonly h: Harness;
  readonly after: ConnectionOperations;
  readonly providers: ProviderList;
}

export interface ReplacingOptions {
  readonly files?: EntryChanges;
  readonly messages?: EntryChanges;
}

function messagesAt(gateway: FakeGateway, changes: EntryChanges): Provider {
  return providerOf({ ...messagesThrough({ url: gateway.url, document: gateway.document }), ...changes });
}

function filesWith(fake: FakeMcpServer, changes: EntryChanges): Provider {
  return providerOf({ ...filesAt(fake).entry, ...changes });
}

function replacementHarness(files: FakeMcpServer, providers: ProviderList): Harness {
  return harness({
    providers,
    policy: replacingPolicy,
    mostSecretCharacters: 4096,
    consenting: { registeredClients: [registeredAt(files.origin)], gateways: true, gatewayEndPauseMs: 0 },
  });
}

async function servedFiles(): Promise<FakeMcpServer> {
  const files = await consentFake();
  onTestFinished(files.close);
  return files;
}

export async function replacingFiles({ files: filesChanges = {}, messages = {} }: ReplacingOptions = {}) {
  const files = await servedFiles();
  const gateway = await gatewayServed();
  const before = providerListOf(filesWith(files, filesChanges), messagesAt(gateway, messages));
  const h = replacementHarness(files, before);
  const providers = providerListOf(
    filesWith(files, filesChanges),
    messagesAt(gateway, { ...messages, replaces: ['files'] }),
  );
  const replacing: Replacing = { files, gateway, h, after: h.operationsWith({ providers }), providers };
  return replacing;
}

export interface ReplacingBySignIn {
  readonly files: FakeMcpServer;
  readonly h: Harness;
  readonly after: ConnectionOperations;
}

export async function replacingFilesBySignIn(): Promise<ReplacingBySignIn> {
  const files = await servedFiles();
  const shared = { ...filesAt(files, sharingWay).entry, name: 'shared-files', title: 'Shared files' };
  const h = replacementHarness(files, providerListOf(filesAt(files), providerOf(shared)));
  const providers = providerListOf(filesAt(files), providerOf({ ...shared, replaces: ['files'] }));
  return { files, h, after: h.operationsWith({ providers }) };
}

export async function connectedFiles({ h }: Pick<Replacing, 'h'>, input: EntryChanges = {}): Promise<Added> {
  const link = await added(h, { provider: 'files', ...input });
  await connectedThrough(h, link);
  return link;
}
