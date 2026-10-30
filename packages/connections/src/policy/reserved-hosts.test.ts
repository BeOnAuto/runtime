import { describe, expect, it } from 'vitest';

import { adding, billing, crmWithTenant, notes } from '../testing/additions.ts';
import { serversTakingASecret } from '../testing/harness-services.ts';
import { harness } from '../testing/harness.ts';
import { connectionPolicyOf } from './connection-policy.ts';

function mcpAt(url: string) {
  return { ...notes, entry: { url } };
}

const namedByTheOperator = ', unless its operator names the host in connections.allowed_hosts';

const answering = { consenting: { fetch: serversTakingASecret } };

function refusedFor(host: string, reached: string, unless = namedByTheOperator) {
  return {
    status: 'rejected',
    reason: 'forbidden',
    detail: `A connection may not reach the host ${host}, ${reached}${unless}`,
  };
}

function unlessFor(reached: string): string {
  return reached.startsWith('a cloud metadata') ? '' : namedByTheOperator;
}

const refusedServers: readonly (readonly [string, string, string])[] = [
  ['loopback', 'https://127.0.0.1/mcp', 'a loopback address'],
  ['loopback, written as a number', 'https://2130706433/mcp', 'a loopback address'],
  ['loopback, in IPv6', 'https://[::1]/mcp', 'a loopback address'],
  ['loopback, in IPv6 around an IPv4 address', 'https://[::ffff:127.0.0.1]/mcp', 'a loopback address'],
  ['loopback, by name', 'https://localhost/mcp', 'a loopback host'],
  ['private, of 10.0.0.0/8', 'https://10.1.2.3/mcp', 'a private address'],
  ['private, of 172.16.0.0/12', 'https://172.16.0.4/mcp', 'a private address'],
  ['private, of 192.168.0.0/16', 'https://192.168.1.10/mcp', 'a private address'],
  ['private, in IPv6', 'https://[fd12:3456::1]/mcp', 'a private address'],
  ['link-local', 'https://169.254.10.10/mcp', 'a link-local address'],
  ['link-local, in IPv6', 'https://[fe80::1]/mcp', 'a link-local address'],
  ['cloud metadata, of AWS, Azure and GCP', 'https://169.254.169.254/latest/meta-data', 'a cloud metadata address'],
  ['cloud metadata, of Alibaba Cloud', 'https://100.100.100.200/latest/meta-data', 'a cloud metadata address'],
  ['cloud metadata, of GCP, by name', 'https://metadata.google.internal/computeMetadata/v1', 'a cloud metadata host'],
];

describe('a server of a connection on an address only its operator may name', () => {
  it.each(refusedServers)('is refused where it is %s, and nothing is recorded', async (_, url, reached) => {
    const h = harness();
    const host = new URL(url).hostname;

    expect(await adding(h, mcpAt(url))).toEqual(refusedFor(host, reached, unlessFor(reached)));
    expect(await h.facts()).toEqual([]);
  });

  it('is refused for the document, the base address and the issuer of an HTTP API, each', async () => {
    const h = harness();
    const document = { ...billing, entry: { document: 'https://10.0.0.7/openapi.json' } };
    const baseUrl = { ...billing, entry: { ...billing.entry, base_url: 'https://169.254.169.254/v2' } };
    const issuer = { ...billing, credential: { ...billing.credential, issuer: 'https://192.168.0.3' } };

    expect([await adding(h, document), await adding(h, baseUrl), await adding(h, issuer)]).toEqual([
      refusedFor('10.0.0.7', 'a private address'),
      refusedFor('169.254.169.254', 'a cloud metadata address', ''),
      refusedFor('192.168.0.3', 'a private address'),
    ]);
  });

  it('is refused whatever the hosts the operator allows beside it', async () => {
    const h = harness({ policy: connectionPolicyOf({ allowed_hosts: ['*.example.com'] }) });

    expect(await adding(h, mcpAt('https://10.1.2.3/mcp'))).toMatchObject({
      reason: 'forbidden',
      detail: 'A connection may not reach the host 10.1.2.3 on this runtime, which allows *.example.com',
    });
  });
});

describe('a server of a connection on an address the operator names or the runtime takes', () => {
  it('is refused at a cloud metadata address or host even when the operator names it', async () => {
    const h = harness({
      policy: connectionPolicyOf({ allowed_hosts: ['169.254.169.254', 'metadata.google.internal'] }),
    });

    expect([
      await adding(h, mcpAt('https://169.254.169.254/mcp')),
      await adding(h, mcpAt('https://metadata.google.internal/mcp')),
    ]).toEqual([
      refusedFor('169.254.169.254', 'a cloud metadata address', ''),
      refusedFor('metadata.google.internal', 'a cloud metadata host', ''),
    ]);
  });

  it('is refused at an address a *. pattern covers, since only a literal name allows one', async () => {
    const h = harness({ policy: connectionPolicyOf({ allowed_hosts: ['*.1.2.3'] }) });

    expect(await adding(h, mcpAt('https://10.1.2.3/mcp'))).toEqual(refusedFor('10.1.2.3', 'a private address'));
  });
});

describe('a server of a connection on a local runtime', () => {
  it('is taken on loopback on a local runtime, and refused at a private address', async () => {
    const h = harness({ ...answering, policy: { ...connectionPolicyOf({}), loopbackAllowed: true } });

    expect([
      (await adding(h, mcpAt('https://127.0.0.1:8443/mcp'))).status,
      (await adding(h, { ...mcpAt('http://localhost:8443/mcp'), name: 'local' })).status,
      (await adding(h, { ...mcpAt('http://[::1]:8443/mcp'), name: 'six' })).status,
    ]).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(await adding(h, mcpAt('https://10.1.2.3/mcp'))).toEqual(refusedFor('10.1.2.3', 'a private address'));
  });

  it('is refused at a loopback address on a local runtime whose operator lists other hosts', async () => {
    const h = harness({
      policy: { ...connectionPolicyOf({ allowed_hosts: ['*.example.com'] }), loopbackAllowed: true },
    });

    expect(await adding(h, mcpAt('https://127.0.0.1/mcp'))).toMatchObject({
      detail: 'A connection may not reach the host 127.0.0.1 on this runtime, which allows *.example.com',
    });
  });

  it('is taken where the operator names its host, exactly or under a *. pattern', async () => {
    const exact = harness({
      ...answering,
      policy: connectionPolicyOf({ allowed_hosts: ['10.1.2.3', '127.0.0.1', '[::1]'] }),
    });
    const under = harness({
      ...answering,
      policy: connectionPolicyOf({ allowed_hosts: ['*.corp.example', 'localhost'] }),
    });

    expect([
      (await adding(exact, mcpAt('https://10.1.2.3/mcp'))).status,
      (await adding(exact, { ...mcpAt('https://127.0.0.1/mcp'), name: 'loopback' })).status,
      (await adding(under, mcpAt('https://wiki.corp.example/mcp'))).status,
      (await adding(under, { ...mcpAt('https://localhost/mcp'), name: 'local' })).status,
    ]).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
  });

  it('is taken at a public address, whatever the operator allows', async () => {
    expect((await adding(harness(), mcpAt('https://8.8.8.8/mcp'))).status).toBe('succeeded');
  });
});

describe('the headers of a connection given by hand', () => {
  it('are taken where the operator names no host, for a server at a public host', async () => {
    const h = harness();

    expect((await adding(h, crmWithTenant)).status).toBe('succeeded');
  });

  it('are taken where the operator names the host', async () => {
    const h = harness({ policy: connectionPolicyOf({ allowed_hosts: ['*.example.com'] }) });

    expect((await adding(h, crmWithTenant)).status).toBe('succeeded');
  });

  it('are refused for a server at an address its operator did not name, as the server is', async () => {
    const h = harness();
    const intranet = { ...crmWithTenant, entry: { ...crmWithTenant.entry, url: 'https://10.0.0.5/mcp' } };

    expect(await adding(h, intranet)).toEqual(refusedFor('10.0.0.5', 'a private address'));
    expect(await h.facts()).toEqual([]);
  });

  it('are taken for a server at an address its operator names', async () => {
    const h = harness({ policy: connectionPolicyOf({ allowed_hosts: ['10.0.0.5'] }) });
    const intranet = { ...crmWithTenant, entry: { ...crmWithTenant.entry, url: 'https://10.0.0.5/mcp' } };

    expect((await adding(h, intranet)).status).toBe('succeeded');
  });

  it('are not needed to add a connection that sends none', async () => {
    expect((await adding(harness(), notes)).status).toBe('succeeded');
  });
});
