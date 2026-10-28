import { describe, expect, it } from 'vitest';

import { loopbackHostOf, operatorMayNameHost, reservedHostKindOf } from '../index.ts';

const metadata = 'a cloud metadata address';

const refusedHosts: readonly (readonly [string, string])[] = [
  ['169.254.169.254', metadata],
  ['100.100.100.200', metadata],
  ['[fd00:ec2::254]', metadata],
  ['metadata.google.internal', 'a cloud metadata host'],
  ['Metadata.Google.Internal.', 'a cloud metadata host'],
  ['127.0.0.1', 'a loopback address'],
  ['127.255.255.254', 'a loopback address'],
  ['[::1]', 'a loopback address'],
  ['localhost', 'a loopback host'],
  ['LOCALHOST.', 'a loopback host'],
  ['crm.localhost', 'a loopback host'],
  ['169.254.0.1', 'a link-local address'],
  ['[fe80::1]', 'a link-local address'],
  ['fe80::1%eth0', 'a link-local address'],
  ['10.0.0.1', 'a private address'],
  ['172.16.0.1', 'a private address'],
  ['172.31.255.255', 'a private address'],
  ['192.168.1.1', 'a private address'],
  ['[fd12:3456::1]', 'a private address'],
  ['100.64.0.1', 'a shared address of a carrier-grade NAT'],
  ['0.0.0.0', 'an unspecified address'],
  ['[::]', 'an unspecified address'],
  ['224.0.0.1', 'a reserved address'],
  ['240.0.0.1', 'a reserved address'],
  ['198.18.0.1', 'a reserved address'],
  ['192.0.0.1', 'a reserved address'],
  ['[ff02::1]', 'a reserved address'],
  ['[::ffff:127.0.0.1]', 'a loopback address'],
  ['[::ffff:7f00:1]', 'a loopback address'],
  ['[::ffff:169.254.169.254]', metadata],
  ['[64:ff9b::a00:1]', 'a private address'],
  ['[64:ff9b:1::1]', 'a reserved address'],
  ['[64:ff9b:1:ffff::1]', 'a reserved address'],
  ['[2002:7f00:1::]', 'a loopback address'],
  ['[2002:a9fe:a9fe::1]', metadata],
  ['[2002:a00:1::1]', 'a private address'],
  ['[::127.0.0.1]', 'a loopback address'],
  ['[::7f00:1]', 'a loopback address'],
  ['[::10.0.0.1]', 'a private address'],
  ['[::169.254.169.254]', metadata],
  ['[::ffff:0:7f00:1]', 'a loopback address'],
  ['[::ffff:10.1.2.3]', 'a private address'],
  ['[0:0:0:0:0:ffff:a9fe:a9fe]', metadata],
  ['[fec0::1]', 'a private address'],
  ['[feff::1]', 'a private address'],
];

const reachedHosts: readonly string[] = [
  '8.8.8.8',
  '1.1.1.1',
  '172.15.255.255',
  '172.32.0.1',
  '100.63.255.255',
  '100.128.0.1',
  '169.253.255.255',
  '[2606:4700::1111]',
  '[::ffff:8.8.8.8]',
  '[64:ff9b::808:808]',
  '[64:ff9b::1:808:808]',
  '[2002:808:808::1]',
  '[::8.8.8.8]',
  '[::ffff:0:808:808]',
  '[2001:4860:4860::8888]',
  'crm.example.com',
  'localhost.example.com',
  'metadata.example.internal',
];

describe('the hosts a connection may reach only where its operator names them', () => {
  it.each(refusedHosts)('names %s as %s', (host, kind) => {
    expect(reservedHostKindOf(host)).toBe(kind);
  });

  it.each(reachedHosts)('leaves %s to the rules of the operator', (host) => {
    expect(reservedHostKindOf(host)).toBeUndefined();
  });

  it('reads an address as the URL standard writes it, however the address was written', () => {
    const written = ['http://2130706433/', 'http://0x7f.1/', 'http://127.1/', 'http://[::ffff:127.0.0.1]/'];

    expect(written.map((address) => reservedHostKindOf(new URL(address).hostname))).toEqual(
      written.map(() => 'a loopback address'),
    );
  });
});

describe('the hosts an operator may name', () => {
  it.each(['10.0.0.5', '127.0.0.1', 'localhost', 'app.localhost', '[fd12:3456::1]', '192.168.0.1'])(
    'lets the operator name %s',
    (host) => {
      expect(operatorMayNameHost(host)).toBe(true);
    },
  );

  it.each([
    '169.254.169.254',
    '100.100.100.200',
    '[fd00:ec2::254]',
    'metadata.google.internal',
    'crm.example.com',
    '8.8.8.8',
  ])('does not let the operator name %s', (host) => {
    expect(operatorMayNameHost(host)).toBe(false);
  });

  it.each(['127.0.0.1', '127.9.9.9', '[::1]', 'localhost', 'LOCALHOST.', 'crm.localhost'])(
    'finds %s on loopback',
    (host) => {
      expect(loopbackHostOf(host)).toBe(true);
    },
  );

  it.each(['10.0.0.5', '169.254.169.254', '8.8.8.8', 'crm.example.com', 'metadata.google.internal'])(
    'finds %s off loopback',
    (host) => {
      expect(loopbackHostOf(host)).toBe(false);
    },
  );
});
