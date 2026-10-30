import { describe, expect, it } from 'vitest';

import { proxySettingsOf } from './proxy-settings.ts';

describe('the settings of the environment proxy', () => {
  it('are off, with no variables, in an environment that sets neither', () => {
    expect(proxySettingsOf({})).toEqual({ enabled: false, environment: {} });
  });

  it('are on with NODE_USE_ENV_PROXY=1 alone, and keep the proxy variables that are set and not empty', () => {
    expect(
      proxySettingsOf({
        NODE_USE_ENV_PROXY: '1',
        HTTPS_PROXY: 'http://proxy.internal:3128',
        http_proxy: '',
        NO_PROXY: '169.254.169.254,metadata.google.internal',
        PATH: '/usr/bin',
      }),
    ).toEqual({
      enabled: true,
      environment: { HTTPS_PROXY: 'http://proxy.internal:3128', NO_PROXY: '169.254.169.254,metadata.google.internal' },
    });
    expect(proxySettingsOf({ NODE_USE_ENV_PROXY: 'true' }).enabled).toBe(false);
  });
});
