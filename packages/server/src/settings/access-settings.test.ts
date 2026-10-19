import type { Environment } from '@on.auto/config';
import { describe, expect, it } from 'vitest';

import { readSettings } from './settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettings(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

const httpOffLoopback =
  'InvalidSettingsError: PUBLIC_URL: Expected an https URL; an http URL is taken only for localhost, 127.0.0.1, or [::1]';

describe('readSettings signing persons in', () => {
  it('signs persons in through the Auto identity service once PUBLIC_URL is set, and on every interface through no one without it', () => {
    expect([
      readSettings({ PUBLIC_URL: 'https://runtime.example.com' }).signIn,
      readSettings({ IDENTITY_ISSUER: 'https://identity.example' }).signIn,
    ]).toEqual([{ issuer: 'https://clerk.on.auto', publicUrl: 'https://runtime.example.com' }, undefined]);
  });

  it('signs persons in through the identity service IDENTITY_ISSUER names, such as a development instance', () => {
    expect(
      readSettings({ IDENTITY_ISSUER: 'https://identity.example', PUBLIC_URL: 'https://runtime.example.com' }).signIn,
    ).toEqual({ issuer: 'https://identity.example', publicUrl: 'https://runtime.example.com' });
  });

  it.each([
    ['127.0.0.1', 'http://localhost:5555'],
    ['127.0.0.1', 'http://127.0.0.1:5555'],
    ['127.0.0.1', 'http://[::1]:5555'],
    ['0.0.0.0', 'http://localhost:5555'],
  ])('takes on HOST=%s the http PUBLIC_URL=%s, whose host is a loopback name', (host, publicUrl) => {
    expect(readSettings({ HOST: host, PUBLIC_URL: publicUrl }).signIn).toEqual({
      issuer: 'https://clerk.on.auto',
      publicUrl,
    });
  });

  it.each([
    ['127.0.0.1', 'http://runtime.example.com'],
    ['0.0.0.0', 'http://runtime.example.com'],
    ['0.0.0.0', 'http://192.168.1.20:5555'],
  ])('refuses on HOST=%s the http PUBLIC_URL=%s, naming the setting', (host, publicUrl) => {
    expect(String(errorFrom({ HOST: host, PUBLIC_URL: publicUrl }))).toBe(httpOffLoopback);
  });
});

describe('readSettings without PUBLIC_URL', () => {
  it.each([
    [{ HOST: '127.0.0.1' }],
    [{ HOST: 'localhost', PORT: '6000' }],
    [{ HOST: '::1' }],
    [{ HOST: '127.0.0.1', PORT: '0' }],
    [{ HOST: '0.0.0.0' }],
    [{ HOST: '127.0.0.1', IDENTITY_ISSUER: 'https://identity.example' }],
  ] as const)('signs no one in with %j, since PUBLIC_URL has no default', (server) => {
    expect(readSettings(server).signIn).toBeUndefined();
  });

  it('signs persons in at PUBLIC_URL on a loopback address when PUBLIC_URL is set', () => {
    expect(readSettings({ HOST: '127.0.0.1', PUBLIC_URL: 'https://runtime.example.com' }).signIn).toEqual({
      issuer: 'https://clerk.on.auto',
      publicUrl: 'https://runtime.example.com',
    });
  });
});

describe('readSettings rejects invalid credential settings', () => {
  it.each([
    'https://runtime.example.com/',
    'https://runtime.example.com/runtime',
    'https://runtime.example.com?tenant=acme',
    'https://runtime.example.com#top',
    'https://Runtime.example.com',
    'ftp://runtime.example.com',
    'runtime.example.com',
  ])('rejects PUBLIC_URL="%s", which is not an https URL without a path, naming the setting', (publicUrl) => {
    expect(String(errorFrom({ PUBLIC_URL: publicUrl }))).toBe(
      'InvalidSettingsError: SchemaError(Expected an https URL with no path, query or fragment, such as https://runtime.example.com\n  at ["PUBLIC_URL"])',
    );
  });

  it.each([
    'http://clerk.on.auto',
    'https://clerk.on.auto/tenant',
    'https://clerk.on.auto?x=1',
    'https://clerk.on.auto#y',
  ])(
    'rejects IDENTITY_ISSUER="%s", which is not the https URL of a service without a path, naming the setting',
    (issuer) => {
      expect(String(errorFrom({ IDENTITY_ISSUER: issuer }))).toBe(
        'InvalidSettingsError: SchemaError(Expected the https URL of the identity service, with no path, query or fragment, such as https://clerk.on.auto\n  at ["IDENTITY_ISSUER"])',
      );
    },
  );
});
