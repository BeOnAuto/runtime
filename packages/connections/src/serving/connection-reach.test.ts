import type { Resolve } from '@on.auto/outbound';
import type { ConnectionUnready, OrgConnection } from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf, type ConnectionPolicyFields } from '../policy/connection-policy.ts';
import { added, crmWithTenant, notes } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';
import { servedAs, sourceOver } from '../testing/served-connections.ts';
import type { ServingServices } from './serving-services.ts';

const crmKey = 'Bearer crm-key-0f3c9a71';

const publicAddress = '93.184.216.34';

function resolving(answers: Readonly<Record<string, readonly string[]>>): Resolve {
  return (host) => {
    const answer = answers[host];
    return answer === undefined ? Promise.reject(new Error(`ENOTFOUND ${host}`)) : Promise.resolve(answer);
  };
}

function policyOf(fields: ConnectionPolicyFields) {
  return { policy: connectionPolicyOf(fields) };
}

function notAllowedUnlessNamed(host: string, reached: string): string {
  return `A connection may not reach the host ${host}, ${reached}, unless its operator names the host in connections.allowed_hosts`;
}

async function connected(h: Harness, input: unknown, given: Readonly<Record<string, string>> = {}): Promise<string> {
  const { id, token } = await added(h, input);
  const operation = Object.keys(given).length === 0 ? 'approve' : 'give_credential';
  await h.call(operationNamed(h.operations, operation), ada, { id, token, ...given });
  return id;
}

type Connected = Extract<OrgConnection['state'], { readonly status: 'connected' }>;

function isConnected(state: OrgConnection['state']): state is Connected {
  return state.status === 'connected';
}

async function connectedUnder(h: Harness, id: string, changes: Partial<Omit<ServingServices, 'registry'>>) {
  const { state } = await servedAs(sourceOver(h, changes), id);
  return Option.getOrThrow(Option.liftPredicate(state, isConnected));
}

async function reachesOf(h: Harness, id: string, changes: Partial<Omit<ServingServices, 'registry'>> = {}) {
  const { server } = await connectedUnder(h, id, changes);
  const { reaches } = await Effect.runPromise(server);
  return (...urls: readonly string[]) => Promise.all(urls.map((url) => Promise.resolve(reaches(url))));
}

async function unreadyUnder(h: Harness, id: string): Promise<ConnectionUnready> {
  const { server } = await connectedUnder(h, id, {});
  return Effect.runPromise(Effect.flip(server));
}

const insideTheNetwork: readonly (readonly [string, string, string])[] = [
  ['https://127.0.0.1:8443/mcp', '127.0.0.1', 'a loopback address'],
  ['https://localhost/mcp', 'localhost', 'a loopback host'],
  ['https://[::1]/mcp', '[::1]', 'a loopback address'],
  ['https://2130706433/mcp', '127.0.0.1', 'a loopback address'],
  ['https://10.0.0.5/mcp', '10.0.0.5', 'a private address'],
  ['https://172.20.1.1/mcp', '172.20.1.1', 'a private address'],
  ['https://192.168.0.1/mcp', '192.168.0.1', 'a private address'],
  ['https://169.254.169.254/latest/meta-data', '169.254.169.254', 'a cloud metadata address'],
  ['https://metadata.google.internal/computeMetadata/v1', 'metadata.google.internal', 'a cloud metadata host'],
  ['https://100.100.100.200/latest/meta-data', '100.100.100.200', 'a cloud metadata address'],
  ['https://[fe80::1]/mcp', '[fe80::1]', 'a link-local address'],
];

const resolvedInsideTheNetwork = resolving({
  'notes.example.com': [publicAddress, '2606:2800:220:1:248:1893:25c8:1946'],
  'rebound.example.com': [publicAddress, '10.0.0.9'],
  'metadata-alias.example.com': ['169.254.169.254'],
  'loopback-alias.example.com': ['::1'],
  'empty.example.com': [],
});

const resolvedRefusals: readonly (readonly [string, string])[] = [
  [
    'https://rebound.example.com/mcp',
    notAllowedUnlessNamed('rebound.example.com', 'which resolves to 10.0.0.9, a private address'),
  ],
  [
    'https://metadata-alias.example.com/mcp',
    notAllowedUnlessNamed('metadata-alias.example.com', 'which resolves to 169.254.169.254, a cloud metadata address'),
  ],
  [
    'https://loopback-alias.example.com/mcp',
    notAllowedUnlessNamed('loopback-alias.example.com', 'which resolves to ::1, a loopback address'),
  ],
  ['https://empty.example.com/mcp', notAllowedUnlessNamed('empty.example.com', 'which resolves to no address')],
  ['https://missing.example.com/mcp', notAllowedUnlessNamed('missing.example.com', 'which resolves to no address')],
];

describe('the hosts a connected connection reaches where its operator names none', () => {
  it('are refused at an address that is loopback, private, link-local or of a cloud metadata service, however it is written', async () => {
    const h = harness();
    const reaches = await reachesOf(h, await connected(h, notes));

    expect(await reaches(...insideTheNetwork.map(([url]) => url))).toEqual(
      insideTheNetwork.map(([, host, kind]) => notAllowedUnlessNamed(host, kind)),
    );
  });
});

describe('the names a connected connection reaches where its operator names none', () => {
  it('are refused where they resolve to such an address, though public, or to none, and taken where they resolve to public ones', async () => {
    const h = harness();
    const reaches = await reachesOf(h, await connected(h, notes), { resolve: resolvedInsideTheNetwork });

    expect(await reaches(notes.entry.url, ...resolvedRefusals.map(([url]) => url))).toEqual([
      undefined,
      ...resolvedRefusals.map(([, refusal]) => refusal),
    ]);
  });
});

describe('the hosts a connected connection reaches where its operator names them', () => {
  it('are taken at an address or a name the operator names, without the name being resolved', async () => {
    const listing = policyOf({ allowed_hosts: ['10.0.0.5', 'wiki.corp.example', '*.internal.example.com'] });
    const h = harness(listing);
    const id = await connected(h, { ...notes, entry: { url: 'https://10.0.0.5/mcp' } });
    const reaches = await reachesOf(h, id, { ...listing, resolve: resolving({}) });

    expect(
      await reaches(
        'https://10.0.0.5/mcp',
        'https://wiki.corp.example/mcp',
        'https://a.internal.example.com/mcp',
        'https://10.0.0.6/mcp',
      ),
    ).toEqual([
      undefined,
      undefined,
      undefined,
      'A connection may not reach the host 10.0.0.6 on this runtime, which allows 10.0.0.5, wiki.corp.example, and *.internal.example.com',
    ]);
  });
});

describe('a connection that reaches an address its operator did not name', () => {
  it('is refused in the words of the rule when it is first used after the rule, its credential unread', async () => {
    const naming = policyOf({ allowed_hosts: ['10.0.0.5'] });
    const h = harness(naming);
    const id = await connected(h, { ...notes, entry: { url: 'https://10.0.0.5/mcp' } });

    expect(await reachesOf(h, id, naming)).toBeDefined();
    expect(await unreadyUnder(h, id)).toEqual({
      because: 'connection_not_allowed',
      detail: notAllowedUnlessNamed('10.0.0.5', 'a private address'),
    });
  });

  it('is refused when it holds headers the operator did not name a host for', async () => {
    const naming = policyOf({ allowed_hosts: ['crm.example.com'] });
    const h = harness(naming);
    const id = await connected(h, crmWithTenant, { value: crmKey });

    expect(await reachesOf(h, id, naming)).toBeDefined();
    expect(await unreadyUnder(h, id)).toEqual({
      because: 'connection_not_allowed',
      detail:
        'A connection sends the headers it is given only to a host its operator names in connections.allowed_hosts, and this runtime names none',
    });
  });
});
