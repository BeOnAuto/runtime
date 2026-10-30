import { describe, expect, it } from 'vitest';

import { HostUnresolved, reservedReachOf, resolvedBySystem, resolvedWith, type Noted, type Resolve } from '../index.ts';

function resolving(answers: Readonly<Record<string, readonly string[]>>): Resolve {
  return (host) => {
    const answer = answers[host];
    return answer === undefined ? Promise.reject(failingWith('ENOTFOUND')) : Promise.resolve(answer);
  };
}

function failingWith(code: string): Error {
  return Object.assign(new Error(`${code} lookup`), { code });
}

function failing(failure: Readonly<Error>): Resolve {
  return () => Promise.reject(failure);
}

const neverAsked: Resolve = (host) => Promise.reject(new Error(`${host} was resolved`));

const publicAddress = '93.184.216.34';

function noting(): { readonly notes: string[]; readonly noted: Noted } {
  const notes: string[] = [];
  return {
    notes,
    noted: (words) => {
      notes.push(words);
    },
  };
}

const unnoted = noting().noted;

describe('the reach of a host that is an address', () => {
  it('names an address it is, and resolves nothing', async () => {
    expect(await reservedReachOf('127.0.0.1', neverAsked, unnoted)).toBe('a loopback address');
    expect(await reservedReachOf('[fe80::1]', neverAsked, unnoted)).toBe('a link-local address');
    expect(await reservedReachOf('localhost', neverAsked, unnoted)).toBe('a loopback host');
    expect(await reservedReachOf('metadata.google.internal', neverAsked, unnoted)).toBe('a cloud metadata host');
  });

  it('leaves a public address as it is, and resolves nothing', async () => {
    expect(await reservedReachOf('8.8.8.8', neverAsked, unnoted)).toBeUndefined();
    expect(await reservedReachOf('[2606:4700::1111]', neverAsked, unnoted)).toBeUndefined();
  });
});

describe('the reach of a host that is a name', () => {
  it('allows a name whose every address is public', async () => {
    const resolve = resolving({ 'crm.example.com': [publicAddress, '2606:2800:220:1:248:1893:25c8:1946'] });
    const { notes, noted } = noting();

    expect(await reservedReachOf('crm.example.com', resolve, noted)).toBeUndefined();
    expect(notes).toEqual([]);
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
    ['2002:7f00:1::', 'a loopback address'],
    ['::127.0.0.1', 'a loopback address'],
  ])('refuses a public name that resolves to %s, naming the kind and noting the address', async (address, kind) => {
    const resolve = resolving({ 'rebound.example.com': [publicAddress, address] });
    const { notes, noted } = noting();

    expect(await reservedReachOf('rebound.example.com', resolve, noted)).toBe(`which resolves to ${kind}`);
    expect(notes).toEqual([`The host rebound.example.com resolves to ${address}, ${kind}`]);
  });
});

describe('the reach of a name that resolves to no address or fails to resolve', () => {
  it('refuses a name that resolves to no address, and a name no address belongs to', async () => {
    const resolve = resolving({ 'empty.example.com': [] });

    expect(await reservedReachOf('empty.example.com', resolve, unnoted)).toBe('which resolves to no address');
    expect(await reservedReachOf('missing.example.com', resolve, unnoted)).toBe('which resolves to no address');
  });

  it.each(['ENODATA', 'EAI_NONAME', 'EAI_NODATA'])('takes %s for a name no address belongs to', async (code) => {
    expect(await reservedReachOf('missing.example.com', failing(failingWith(code)), unnoted)).toBe(
      'which resolves to no address',
    );
  });

  it.each(['EAI_AGAIN', 'EAI_FAIL', 'ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED', 'EREFUSED', 'ECANCELLED', 'EAI_MEMORY'])(
    'fails, for the caller to try again, where the lookup fails with %s',
    async (code) => {
      await expect(reservedReachOf('slow.example.com', failing(failingWith(code)), unnoted)).rejects.toEqual(
        new HostUnresolved({ host: 'slow.example.com' }),
      );
    },
  );

  it('reads the code of the cause of the failure', async () => {
    const wrapped = new Error('lookup failed', { cause: failingWith('EAI_AGAIN') });

    await expect(reservedReachOf('slow.example.com', failing(wrapped), unnoted)).rejects.toBeInstanceOf(HostUnresolved);
  });

  it('refuses a name whose address cannot be looked up, where the lookup fails for no reason of DNS', async () => {
    const resolve = failing(new TypeError('lookup is not a function'));

    expect(await reservedReachOf('crm.example.com', resolve, unnoted)).toBe(
      'whose address this runtime cannot look up',
    );
  });

  it('refuses a name whose address cannot be looked up, where the code of the failure is none of DNS', async () => {
    const resolve = failing(failingWith('ERR_UNKNOWN_BUILTIN_MODULE'));

    expect(await reservedReachOf('crm.example.com', resolve, unnoted)).toBe(
      'whose address this runtime cannot look up',
    );
  });
});

describe('the addresses the system resolves', () => {
  it('answers the addresses of a name, loopback for localhost', async () => {
    const addresses = await resolvedBySystem('localhost');

    expect(addresses.length).toBeGreaterThan(0);
    expect(await reservedReachOf('localhost.', resolvedBySystem, unnoted)).toBe('a loopback host');
    expect(addresses.every((address) => ['127.0.0.1', '::1'].includes(address))).toBe(true);
  });

  it('fails for a name no address belongs to', async () => {
    await expect(resolvedBySystem('nobody.invalid')).rejects.toBeInstanceOf(Error);
    expect(await reservedReachOf('nobody.invalid', resolvedBySystem, unnoted)).toBe('which resolves to no address');
  });

  it('answers the addresses its lookup gives', async () => {
    const resolve = resolvedWith(() =>
      Promise.resolve({ lookup: () => Promise.resolve([{ address: publicAddress }, { address: '::1' }]) }),
    );

    expect(await resolve('crm.example.com')).toEqual([publicAddress, '::1']);
  });

  it('refuses, as a lookup this runtime cannot make, where the lookup cannot be loaded', async () => {
    const resolve = resolvedWith(() => Promise.reject(new Error('No such built-in module: node:dns/promises')));

    expect(await reservedReachOf('crm.example.com', resolve, unnoted)).toBe(
      'whose address this runtime cannot look up',
    );
  });

  it('refuses, as a lookup this runtime cannot make, where the lookup fails for no reason of DNS', async () => {
    const resolve = resolvedWith(() =>
      Promise.resolve({ lookup: () => Promise.reject(new TypeError('not a function')) }),
    );

    expect(await reservedReachOf('crm.example.com', resolve, unnoted)).toBe(
      'whose address this runtime cannot look up',
    );
  });
});
