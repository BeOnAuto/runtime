import { describe, expect, it } from 'vitest';

import { accessModeOf, createApiKey, type AccessFacts, type AccessMode } from '../index.ts';

const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const modes: ReadonlyArray<readonly [string, AccessFacts, AccessMode | undefined]> = [
  ['nothing set, on a loopback address', { host: '127.0.0.1', apiKeys: undefined, signsIn: false }, 'local'],
  ['nothing set, on localhost', { host: 'localhost', apiKeys: undefined, signsIn: false }, 'local'],
  ['keys, on a loopback address', { host: '127.0.0.1', apiKeys: [entry], signsIn: false }, 'credentials'],
  ['sign-in, on any address', { host: '0.0.0.0', apiKeys: undefined, signsIn: true }, 'credentials'],
  ['a list of no keys, without sign-in', { host: '0.0.0.0', apiKeys: [], signsIn: false }, 'closed'],
  ['a list of no keys, beside sign-in', { host: '0.0.0.0', apiKeys: [], signsIn: true }, 'credentials'],
  ['nothing set, beyond loopback', { host: '0.0.0.0', apiKeys: undefined, signsIn: false }, undefined],
];

describe('the access mode a server is in', () => {
  it.each(modes)('follows from %s', (_case, facts, mode) => {
    expect(accessModeOf(facts)).toBe(mode);
  });
});
