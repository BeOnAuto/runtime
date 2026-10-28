import { isIP } from 'node:net';

import { Data } from 'effect';

import { codesOf } from '../causes/error-causes.ts';
import { reservedAddressKindOf, reservedHostKindOf } from './reserved-addresses.ts';

export type Resolve = (host: string) => Promise<readonly string[]>;

export type Noted = (words: string) => void;

export class HostUnresolved extends Data.TaggedError('host_unresolved')<{ readonly host: string }> {}

type LookupFailure = 'none' | 'retry' | 'unavailable';

type LookedUp = { readonly addresses: readonly string[] } | { readonly failed: LookupFailure };

const refusedLookups: Readonly<Record<Exclude<LookupFailure, 'retry'>, string>> = {
  none: 'which resolves to no address',
  unavailable: 'whose address this runtime cannot look up',
};

const noAddressCodes: ReadonlySet<unknown> = new Set(['ENOTFOUND', 'ENODATA', 'EAI_NONAME', 'EAI_NODATA']);

const retryableCodes: ReadonlySet<unknown> = new Set([
  'EAI_AGAIN',
  'EAI_FAIL',
  'EAI_MEMORY',
  'ESERVFAIL',
  'ETIMEOUT',
  'ECONNREFUSED',
  'EREFUSED',
  'ECANCELLED',
]);

type SystemLookup = (
  host: string,
  options: Readonly<{ all: true; order: 'verbatim' }>,
) => Promise<readonly Readonly<{ address: string }>[]>;

interface LookupModule {
  readonly lookup: SystemLookup;
}

export function resolvedWith(load: () => Promise<Readonly<LookupModule>>): Resolve {
  return async (host) => {
    const { lookup } = await load();
    const answers = await lookup(host, { all: true, order: 'verbatim' });
    return answers.map(({ address }) => address);
  };
}

export const resolvedBySystem: Resolve = resolvedWith(() => import('node:dns/promises'));

function lookupFailureOf(error: unknown): LookupFailure {
  const codes = codesOf(error);
  if (codes.some((code) => noAddressCodes.has(code))) {
    return 'none';
  }
  return codes.some((code) => retryableCodes.has(code)) ? 'retry' : 'unavailable';
}

async function lookedUp(host: string, resolve: Resolve): Promise<LookedUp> {
  try {
    return { addresses: await resolve(host) };
  } catch (error) {
    return { failed: lookupFailureOf(error) };
  }
}

function reservedAnswerOf(host: string, addresses: readonly string[], noted: Noted): string | undefined {
  for (const address of addresses) {
    const kind = reservedAddressKindOf(address);
    if (kind !== undefined) {
      noted(`The host ${host} resolves to ${address}, ${kind}`);
      return `which resolves to ${kind}`;
    }
  }
  return undefined;
}

function refusalOfAnswer(host: string, answer: LookedUp, noted: Noted): string | undefined {
  if ('failed' in answer) {
    if (answer.failed === 'retry') {
      throw new HostUnresolved({ host });
    }
    return refusedLookups[answer.failed];
  }
  return answer.addresses.length === 0 ? refusedLookups.none : reservedAnswerOf(host, answer.addresses, noted);
}

function isAddressLiteral(host: string): boolean {
  return isIP(host.replaceAll(/^\[|\]$/gu, '')) !== 0;
}

export async function reservedReachOf(host: string, resolve: Resolve, noted: Noted): Promise<string | undefined> {
  const named = reservedHostKindOf(host);
  if (named !== undefined || isAddressLiteral(host)) {
    return named;
  }
  return refusalOfAnswer(host, await lookedUp(host, resolve), noted);
}
