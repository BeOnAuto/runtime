import { describe, expect, it } from 'vitest';

import { canonicalHostOf, namesAPrivateHost } from '../index.ts';

function privateAmong(hosts: readonly string[]): readonly string[] {
  return hosts.filter((host) => namesAPrivateHost(host));
}

describe('a private address', () => {
  it('is an IPv4 address of the loopback, a private network, a link, a shared or reserved range, or many hosts', () => {
    const hosts = [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '100.127.255.254',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.170',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '239.255.255.250',
      '240.0.0.1',
      '255.255.255.255',
    ];

    expect(privateAmong(hosts)).toEqual(hosts);
  });

  it('is an IPv6 address of the loopback, a link, a unique local network, a reserved range or many hosts', () => {
    const hosts = [
      '[::]',
      '[::1]',
      '::1',
      '[::7f00:1]',
      '[64:ff9b:1::1]',
      '[100::1]',
      '[2001::1]',
      '[2001:db8::1]',
      '[fc00::1]',
      '[fd12:3456::1]',
      '[fe80::1]',
      '[fec0::1]',
      '[ff02::1]',
    ];

    expect(privateAmong(hosts)).toEqual(hosts);
  });
});

describe('a private IPv6 address holding an IPv4 address', () => {
  it('is an IPv6 address that holds a private IPv4 address, mapped, translated, through NAT64 or 6to4', () => {
    const hosts = [
      '[::ffff:127.0.0.1]',
      '[::ffff:a9fe:a9fe]',
      '[::ffff:0:a9fe:a9fe]',
      '[64:ff9b::a9fe:a9fe]',
      '[64:ff9b::10.0.0.1]',
      '[2002:a9fe:a9fe::1]',
      '[2002:c0a8:101::]',
    ];

    expect(privateAmong(hosts)).toEqual(hosts);
  });
});

describe('a private host as a URL writes it', () => {
  it('is the address of the loopback or of a metadata service however a URL writes it', () => {
    const hosts = [
      'http://2130706433/',
      'http://0x7f.1/',
      'http://0177.0.0.1/',
      'http://127.1/',
      'http://0/',
      'http://0xa9.0xfe.0xa9.0xfe/',
      'http://2852039166/',
      'http://[::ffff:169.254.169.254]/',
      'http://LOCALHOST./',
      'http://metadata.google.internal./',
    ].map((url) => new URL(url).hostname);

    expect(privateAmong(hosts)).toEqual(hosts);
  });
});

describe('a private name', () => {
  it('is a name of one label, of the loopback, of a local or internal network, or of a metadata service', () => {
    const hosts = [
      'localhost',
      'metadata',
      'kubernetes',
      'studio.localhost',
      'printer.local',
      'nas.localdomain',
      'metadata.google.internal',
      'instance-data.ec2.internal',
      'router.home.arpa',
      'metadata.azure.com',
      'metadata.tencentyun.com',
      'Metadata.Google.Internal.',
    ];

    expect(privateAmong(hosts)).toEqual(hosts);
  });

  it('is a host no URL could hold, which nothing reaches anyway', () => {
    expect(privateAmong(['', 'exa mple', '[1:::2]'])).toEqual(['', 'exa mple', '[1:::2]']);
  });
});

describe('a public host', () => {
  it('is never private, as an address or a name', () => {
    expect(
      privateAmong([
        'example.com',
        'mcp.slack.com',
        'azure.com',
        'internal.example.com',
        '8.8.8.8',
        '100.63.255.255',
        '100.128.0.1',
        '172.15.255.255',
        '172.32.0.1',
        '169.253.255.255',
        '198.20.0.1',
        '223.255.255.255',
        '[2606:4700:4700::1111]',
        '[2001:4860:4860::8888]',
        '[::ffff:8.8.8.8]',
        '[64:ff9b::808:808]',
        '[2002:808:808::1]',
        '[2001:db9::1]',
        '[2600:1f18:1:2:3:4:5:6]',
      ]),
    ).toEqual([]);
  });
});

describe('the canonical form of a host', () => {
  it('is the host a URL holds, lower case and without a final dot', () => {
    expect(
      ['LocalHost.', '2130706433', '::1', '[0:0::1]', 'CRM.Example.com', '[::ffff:127.0.0.1]', 'exa mple'].map((host) =>
        canonicalHostOf(host),
      ),
    ).toEqual(['localhost', '127.0.0.1', '[::1]', '[::1]', 'crm.example.com', '[::ffff:7f00:1]', undefined]);
  });
});
