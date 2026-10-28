import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { reservedAddressKindOf, reservedHostKindOf } from './reserved-addresses.ts';

export type Resolve = (host: string) => Promise<readonly string[]>;

const noAddress = 'which resolves to no address';

export const resolvedBySystem: Resolve = async (host) => {
  const answers = await lookup(host, { all: true, order: 'verbatim' });
  return answers.map(({ address }: Readonly<LookupAddress>) => address);
};

async function resolvedAddressesOf(host: string, resolve: Resolve): Promise<readonly string[]> {
  try {
    return await resolve(host);
  } catch {
    return [];
  }
}

function reservedAnswerOf(addresses: readonly string[]): string | undefined {
  for (const address of addresses) {
    const kind = reservedAddressKindOf(address);
    if (kind !== undefined) {
      return `which resolves to ${address}, ${kind}`;
    }
  }
  return undefined;
}

function isAddressLiteral(host: string): boolean {
  return isIP(host.replaceAll(/^\[|\]$/gu, '')) !== 0;
}

export async function reservedReachOf(host: string, resolve: Resolve): Promise<string | undefined> {
  const named = reservedHostKindOf(host);
  if (named !== undefined || isAddressLiteral(host)) {
    return named;
  }
  const addresses = await resolvedAddressesOf(host, resolve);
  return addresses.length === 0 ? noAddress : reservedAnswerOf(addresses);
}
