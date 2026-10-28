import { describe, expect, it } from 'vitest';

import { reservedReachOf, resolvedBySystem, type Resolve } from '../index.ts';

function resolving(answers: Readonly<Record<string, readonly string[]>>): Resolve {
  return (host) => {
    const answer = answers[host];
    return answer === undefined ? Promise.reject(new Error(`ENOTFOUND ${host}`)) : Promise.resolve(answer);
  };
}

const neverAsked: Resolve = (host) => Promise.reject(new Error(`${host} was resolved`));

const publicAddress = '93.184.216.34';

describe('the reach of a host that is not an address', () => {
  it('names an address it is, and resolves nothing', async () => {
    expect(await reservedReachOf('127.0.0.1', neverAsked)).toBe('a loopback address');
    expect(await reservedReachOf('[fe80::1]', neverAsked)).toBe('a link-local address');
    expect(await reservedReachOf('localhost', neverAsked)).toBe('a loopback host');
    expect(await reservedReachOf('metadata.google.internal', neverAsked)).toBe('a cloud metadata host');
  });

  it('leaves a public address as it is, and resolves nothing', async () => {
    expect(await reservedReachOf('8.8.8.8', neverAsked)).toBeUndefined();
    expect(await reservedReachOf('[2606:4700::1111]', neverAsked)).toBeUndefined();
  });

  it('allows a name whose every address is public', async () => {
    const resolve = resolving({ 'crm.example.com': [publicAddress, '2606:2800:220:1:248:1893:25c8:1946'] });

    expect(await reservedReachOf('crm.example.com', resolve)).toBeUndefined();
  });

  it.each([
    ['10.1.2.3', 'a private address'],
    ['172.20.0.5', 'a private address'],
    ['192.168.0.9', 'a private address'],
    ['127.0.0.1', 'a loopback address'],
    ['::1', 'a loopback address'],
    ['169.254.169.254', 'a cloud metadata address'],
    ['169.254.10.10', 'a link-local address'],
    ['fe80::1%eth0', 'a link-local address'],
    ['::ffff:10.0.0.1', 'a private address'],
  ])('refuses a public name that resolves to %s', async (address, kind) => {
    const resolve = resolving({ 'rebound.example.com': [publicAddress, address] });

    expect(await reservedReachOf('rebound.example.com', resolve)).toBe(`which resolves to ${address}, ${kind}`);
  });

  it('refuses a name that resolves to no address, and a name that does not resolve', async () => {
    const resolve = resolving({ 'empty.example.com': [] });

    expect(await reservedReachOf('empty.example.com', resolve)).toBe('which resolves to no address');
    expect(await reservedReachOf('missing.example.com', resolve)).toBe('which resolves to no address');
  });
});

describe('the addresses the system resolves', () => {
  it('answers the addresses of a name, loopback for localhost', async () => {
    const addresses = await resolvedBySystem('localhost');

    expect(addresses.length).toBeGreaterThan(0);
    expect(await reservedReachOf('localhost.', resolvedBySystem)).toBe('a loopback host');
    expect(addresses.every((address) => ['127.0.0.1', '::1'].includes(address))).toBe(true);
  });

  it('fails for a name no address belongs to', async () => {
    await expect(resolvedBySystem('nobody.invalid')).rejects.toBeInstanceOf(Error);
    expect(await reservedReachOf('nobody.invalid', resolvedBySystem)).toBe('which resolves to no address');
  });
});
