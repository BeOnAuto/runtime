import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { awsClientSettingsOf, awsCredentialChain, awsDatabaseTokenSigner } from './aws-clients.ts';

const disabledProxy = { enabled: false, environment: { HTTPS_PROXY: 'http://proxy.internal:3128' } };

const enabledProxy = {
  enabled: true,
  environment: { HTTPS_PROXY: 'http://proxy.internal:3128', NO_PROXY: '169.254.169.254' },
};

const secretKey = 'a-secret-access-key';

const database = { hostname: 'db.example.com', port: 5432, username: 'auto runtime', region: 'eu-west-1' };

function keysInTheEnvironment(): void {
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'an-access-key');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', secretKey);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}

describe('the settings of an AWS client', () => {
  it('leave the request handler to the client without the environment proxy', () => {
    expect(awsClientSettingsOf(disabledProxy)).toEqual({});
  });

  it('send its requests through the environment proxy when it is enabled, by HTTP and HTTPS alike', () => {
    const proxyEnv = { HTTPS_PROXY: 'http://proxy.internal:3128', NO_PROXY: '169.254.169.254' };

    expect(awsClientSettingsOf(enabledProxy)).toEqual({
      requestHandler: { httpAgent: { proxyEnv }, httpsAgent: { proxyEnv } },
    });
  });
});

describe('the default credential chain of AWS', () => {
  it('is built without looking anything up, with the environment proxy or without it', () => {
    expect(typeof awsCredentialChain(disabledProxy)).toBe('function');
    expect(typeof awsCredentialChain(enabledProxy)).toBe('function');
  });
});

describe('the signer of the tokens a database user signs in with', () => {
  it('signs a token for the host, the port, the user and the region it is given, valid for fifteen minutes', async () => {
    keysInTheEnvironment();

    const token = await awsDatabaseTokenSigner(enabledProxy, database)();

    expect(token).toMatch(
      /^db\.example\.com:5432\/\?Action=connect&DBUser=auto%20runtime&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=an-access-key%2F\d{8}%2Feu-west-1%2Frds-db%2Faws4_request&X-Amz-Date=\d{8}T\d{6}Z&X-Amz-Expires=900&X-Amz-Signature=[0-9a-f]{64}&X-Amz-SignedHeaders=host$/u,
    );
    expect(token).not.toContain(secretKey);
  });

  it('looks its credentials up when it is asked for a token, not when it is made', async () => {
    const sign = awsDatabaseTokenSigner(disabledProxy, database);
    keysInTheEnvironment();

    await expect(sign()).resolves.toContain('X-Amz-Credential=an-access-key%2F');
  });
});
