import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Environment } from '@on.auto/config';
import { describe, expect, it } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

const defaults = {
  issuer: 'https://identity.example/default',
  scopes: ['openid', 'groups'],
  requiredClaim: { claim: 'tenant' },
};

const publicUrl = 'https://auto.example.com';

function signingInOf(environment: Environment) {
  const { signIn, openIdConnect, openIdConnectByDefault } = readSettingsOf(environment, defaults);
  return { signIn, openIdConnect, openIdConnectByDefault };
}

function settingNamedBy(environment: Environment): string | undefined {
  try {
    readSettingsOf(environment, defaults);
  } catch (error) {
    return /^([A-Z_]+):/u.exec(String(Reflect.get(new Object(error), 'message')))?.[1];
  }
  return undefined;
}

describe('readSettings with PUBLIC_URL and no OIDC_ISSUER', () => {
  it('signs people in at the default identity provider, with its scopes and the name of its required claim', () => {
    expect(signingInOf({ PUBLIC_URL: publicUrl })).toEqual({
      signIn: { issuer: defaults.issuer, publicUrl },
      openIdConnect: undefined,
      openIdConnectByDefault: {
        issuer: defaults.issuer,
        client: undefined,
        scopes: defaults.scopes,
        tokenEndpointAuthMethod: undefined,
        publicUrl,
        redirectUri: `${publicUrl}/auth/oidc/callback`,
        requiredClaim: { claim: 'tenant' },
      },
    });
  });

  it('takes the claim and the value OIDC_REQUIRED_CLAIM gives in place of the name alone', () => {
    const { openIdConnectByDefault } = signingInOf({ PUBLIC_URL: publicUrl, OIDC_REQUIRED_CLAIM: 'team=acme' });

    expect([openIdConnectByDefault?.issuer, openIdConnectByDefault?.requiredClaim]).toEqual([
      defaults.issuer,
      { claim: 'team', requiredValue: 'acme' },
    ]);
  });
});

describe('readSettings with OIDC_ISSUER, in local mode, or with API keys alone', () => {
  it('is the identity provider OIDC_ISSUER names wherever it is set, and none in local mode or with API keys alone', () => {
    const company = { PUBLIC_URL: publicUrl, OIDC_ISSUER: 'https://login.example.com/acme' };
    const local = { HOST: '127.0.0.1', PUBLIC_URL: 'http://localhost:5555', ACCESS_MODE: 'local' };
    const keysAlone = { API_KEYS: '[]', OIDC_SCOPES: 'openid', OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_post' };
    const environments: readonly Environment[] = [company, local, { ...local, OIDC_SCOPES: 'openid' }, keysAlone];

    expect(
      [...environments, { HOST: '127.0.0.1' }].map((environment: Environment) => {
        const { openIdConnect, openIdConnectByDefault } = signingInOf(environment);
        return [openIdConnect?.issuer, openIdConnectByDefault];
      }),
    ).toEqual([
      [company.OIDC_ISSUER, undefined],
      [undefined, undefined],
      [undefined, undefined],
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });
});

const localWithAClaim = {
  HOST: '127.0.0.1',
  PUBLIC_URL: 'http://localhost:5555',
  ACCESS_MODE: 'local',
  OIDC_REQUIRED_CLAIM: 'team=acme',
};

describe('readSettings refusing to guess half a set-up without OIDC_ISSUER', () => {
  it.each<[string, Environment]>([
    ['OIDC_ISSUER', { PUBLIC_URL: publicUrl, OIDC_CLIENT_ID: 'auto-runtime' }],
    ['OIDC_ISSUER', { PUBLIC_URL: publicUrl, OIDC_CLIENT_SECRET: 'secret', OIDC_REQUIRED_CLAIM: 'team=acme' }],
    ['OIDC_SCOPES', { PUBLIC_URL: publicUrl, OIDC_SCOPES: 'openid email' }],
    [
      'OIDC_TOKEN_ENDPOINT_AUTH_METHOD',
      { PUBLIC_URL: publicUrl, OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_post' },
    ],
    ['OIDC_ISSUER', { API_KEYS: '[]', OIDC_CLIENT_ID: 'auto-runtime' }],
    ['OIDC_REQUIRED_CLAIM', { API_KEYS: '[]', OIDC_REQUIRED_CLAIM: 'team=acme' }],
    ['OIDC_REQUIRED_CLAIM', { HOST: '127.0.0.1', OIDC_REQUIRED_CLAIM: 'team=acme', OIDC_CLIENT_ID: 'auto-runtime' }],
    ['ACCESS_MODE', localWithAClaim],
    ['PUBLIC_URL', { HOST: '127.0.0.1', PUBLIC_URL: 'http://localhost:5555' }],
  ])(
    'refuses to start, naming %s, where no sign-in would check the claim or keep its cookie',
    (setting, environment) => {
      expect(settingNamedBy(environment)).toBe(setting);
    },
  );
});

const runtimeFolder = fileURLToPath(new URL('../../../..', import.meta.url));

const namedImportsAndExports = /^(?:import|export)\s*\{([^}]*)\}\s*from\s*'[^']+';/gmu;

const notSources: ReadonlySet<string> = new Set(['node_modules', 'coverage', 'dist']);

function sourcesUnder(folder: string): readonly string[] {
  return readdirSync(join(runtimeFolder, folder)).flatMap((name): readonly string[] => {
    const path = join(folder, name);
    if (notSources.has(name) || name.startsWith('.')) {
      return [];
    }
    if (lstatSync(join(runtimeFolder, path)).isDirectory()) {
      return sourcesUnder(path);
    }
    return name.endsWith('.ts') ? [path] : [];
  });
}

function bindsBy(file: string, name: string): boolean {
  return [...readFileSync(join(runtimeFolder, file), 'utf8').matchAll(namedImportsAndExports)].some(
    ([, names = '']: readonly string[]) => names.split(',').some((each) => each.trim() === name),
  );
}

describe('the default identity provider', () => {
  it('is the Auto identity service, asked for the organization, admitting by the claim org_id, with no value known', () => {
    expect(readSettingsOf({ PUBLIC_URL: publicUrl }).openIdConnectByDefault).toMatchObject({
      issuer: 'https://clerk.on.auto',
      scopes: ['openid', 'profile', 'email', 'user:org:read'],
      requiredClaim: { claim: 'org_id' },
    });
  });

  it('is imported by the settings reader alone, and re-exported by its package entry', () => {
    const name = ['default', 'Identity', 'Provider'].join('');
    const files = ['packages', 'capabilities', 'scripts'].flatMap((folder) => sourcesUnder(folder));

    expect(files.length).toBeGreaterThan(1000);
    expect(files.filter((file) => bindsBy(file, name)).toSorted()).toEqual([
      join('packages', 'identity', 'src', 'index.ts'),
      join('packages', 'server', 'src', 'settings', 'openid-connect-settings.ts'),
    ]);
  });
});
