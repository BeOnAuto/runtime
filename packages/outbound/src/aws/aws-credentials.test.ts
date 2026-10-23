import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { awsCredentialChainOf } from '../index.ts';

const modulesLoaded = createRequire(import.meta.url).cache;

function credentialProvidersLoaded(): readonly string[] {
  return Object.keys(modulesLoaded).filter((path) => path.includes('/@aws-sdk/credential-providers/'));
}

describe('the default credential chain of AWS, from the main entry', () => {
  it('loads the credential providers of the AWS SDK when it is first asked for, and not with the entry', async () => {
    expect(credentialProvidersLoaded()).toEqual([]);

    const chain = await awsCredentialChainOf({ enabled: false, environment: {} });

    expect(typeof chain).toBe('function');
    expect(credentialProvidersLoaded()).toContainEqual(
      expect.stringContaining('/@aws-sdk/credential-providers/dist-cjs/'),
    );
  });
});
