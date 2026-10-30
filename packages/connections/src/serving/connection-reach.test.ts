import { HostUnresolved, type Resolve } from '@on.auto/outbound';
import type { ConnectionUnready, OrgConnection } from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { connectionPolicyOf, type ConnectionPolicyFields } from '../policy/connection-policy.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import { added, crmWithTenant, notes } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';
import { servedAs, sourceOver } from '../testing/served-connections.ts';
import type { ServingServices } from './serving-services.ts';

const crmKey = 'Bearer crm-key-0f3c9a71';

const publicAddress = '93.184.216.34';

function resolving(answers: Readonly<Record<string, readonly string[]>>): Resolve {
  return (host) => {
    const answer = answers[host];
    return answer === undefined
      ? Promise.reject(Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' }))
      : Promise.resolve(answer);
  };
}

function policyOf(fields: ConnectionPolicyFields) {
  return { policy: connectionPolicyOf(fields) };
}

function notAllowedUnlessNamed(host: string, reached: string): string {
  const unless = reached.startsWith('a cloud metadata')
    ? ''
    : ', unless its operator names the host in connections.allowed_hosts';
  return `A connection may not reach the host ${host}, ${reached}${unless}`;
}

function notAllowedForWhatItResolvesTo(host: string, reached: string): string {
  return `A connection may not reach the host ${host}, which resolves to ${reached}`;
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

const timedOut = () => Promise.reject(Object.assign(new Error('timed out'), { code: 'EAI_AGAIN' }));

const broken = () => Promise.reject(new TypeError('lookup is not a function'));

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
  ['https://rebound.example.com/mcp', notAllowedForWhatItResolvesTo('rebound.example.com', 'a private address')],
  [
    'https://metadata-alias.example.com/mcp',
    notAllowedForWhatItResolvesTo('metadata-alias.example.com', 'a cloud metadata address'),
  ],
  [
    'https://loopback-alias.example.com/mcp',
    notAllowedForWhatItResolvesTo('loopback-alias.example.com', 'a loopback address'),
  ],
  ['https://empty.example.com/mcp', notAllowedForWhatItResolvesTo('empty.example.com', 'no address')],
  ['https://missing.example.com/mcp', notAllowedForWhatItResolvesTo('missing.example.com', 'no address')],
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
  it('are taken at an address the operator names, without it being resolved, and at a name that resolves to public addresses', async () => {
    const listing = policyOf({ allowed_hosts: ['10.0.0.5', 'wiki.corp.example', '*.internal.example.com'] });
    const h = harness(listing);
    const id = await connected(h, { ...notes, entry: { url: 'https://10.0.0.5/mcp' } });
    const resolve = resolving({ 'wiki.corp.example': [publicAddress], 'a.internal.example.com': [publicAddress] });
    const reaches = await reachesOf(h, id, { ...listing, resolve });

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

describe('the names a connected connection reaches where its operator lists them', () => {
  it('are refused at a name they list that resolves to a private or metadata address, a *. pattern or not', async () => {
    const listing = policyOf({ allowed_hosts: ['*.example.com', 'wiki.corp.example', 'intranet.example.net'] });
    const h = harness(listing);
    const id = await connected(h, notes);
    const resolve = resolving({
      'alias.example.com': ['169.254.169.254'],
      'wiki.corp.example': ['10.0.0.9'],
      'intranet.example.net': ['::ffff:192.168.0.1'],
    });
    const reaches = await reachesOf(h, id, { ...listing, resolve });

    expect(
      await reaches(
        'https://alias.example.com/mcp',
        'https://wiki.corp.example/mcp',
        'https://intranet.example.net/mcp',
      ),
    ).toEqual([
      notAllowedForWhatItResolvesTo('alias.example.com', 'a cloud metadata address'),
      notAllowedForWhatItResolvesTo('wiki.corp.example', 'a private address'),
      notAllowedForWhatItResolvesTo('intranet.example.net', 'a private address'),
    ]);
  });

  it('are refused at an address a *. pattern covers, though it is not resolved', async () => {
    const reaches = reachesUnder(connectionPolicyOf({ allowed_hosts: ['*.0.0.5'] }), resolving({}));

    expect(await reaches('https://10.0.0.5/mcp')).toEqual(notAllowedUnlessNamed('10.0.0.5', 'a private address'));
  });
});

describe('the hosts of a connected connection on a local runtime', () => {
  it('are taken on loopback whatever the operator names, and refused at any other reserved address', async () => {
    const local = { policy: { ...connectionPolicyOf({}), loopbackAllowed: true } };
    const h = harness(local);
    const id = await connected(h, notes);
    const reaches = await reachesOf(h, id, { ...local, resolve: resolving({}) });

    expect(
      await reaches(
        'http://127.0.0.1:8443/mcp',
        'http://localhost:8443/mcp',
        'http://[::1]:8443/mcp',
        'http://10.0.0.5/mcp',
        'http://127.0.0.1.nip.example/mcp',
      ),
    ).toEqual([
      undefined,
      undefined,
      undefined,
      notAllowedUnlessNamed('10.0.0.5', 'a private address'),
      notAllowedForWhatItResolvesTo('127.0.0.1.nip.example', 'no address'),
    ]);
  });
});

describe('a name a connected connection reaches whose lookup does not answer', () => {
  it('is not refused as a host: the call fails, for the caller to try again', async () => {
    const h = harness();
    const id = await connected(h, notes);
    const { server } = await connectedUnder(h, id, { resolve: timedOut });
    const { reaches } = await Effect.runPromise(server);

    await expect(Promise.resolve(reaches('https://notes.example.com/mcp'))).rejects.toEqual(
      new HostUnresolved({ host: 'notes.example.com' }),
    );
  });

  it('is refused as a host whose address this runtime cannot look up, where the lookup breaks for no reason of DNS', async () => {
    const h = harness();
    const id = await connected(h, notes);
    const reaches = await reachesOf(h, id, { resolve: broken });

    expect(await reaches('https://notes.example.com/mcp')).toEqual([
      'A connection may not reach the host notes.example.com, whose address this runtime cannot look up',
    ]);
  });
});

describe('the address a name resolved to, which a refusal does not name', () => {
  it('is logged for whoever runs the runtime, and is not in the refusal', async () => {
    const h = harness();
    const id = await connected(h, notes);
    const resolve = resolving({ 'rebound.example.com': [publicAddress, '10.0.0.9'] });
    const reaches = await reachesOf(h, id, { resolve });
    const lines: string[] = [];
    const logged = vi.spyOn(console, 'log').mockImplementation((...written: readonly unknown[]) => {
      lines.push(...written.map(String));
    });

    const [refusal] = await reaches('https://rebound.example.com/mcp');
    logged.mockRestore();

    expect(refusal).not.toContain('10.0.0.9');
    expect(lines.join('\n')).toContain('The host rebound.example.com resolves to 10.0.0.9, a private address');
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

  it('keeps its headers while it reaches a public host, whatever the operator names', async () => {
    const naming = policyOf({ allowed_hosts: ['crm.example.com'] });
    const h = harness(naming);
    const id = await connected(h, crmWithTenant, { value: crmKey });

    expect(await reachesOf(h, id, naming)).toBeDefined();
  });
});
