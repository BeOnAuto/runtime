import type { VendorOfTheWay } from './vendor-fakes.ts';

const google = 'https://accounts.google.com';

export const googleApi: VendorOfTheWay = {
  metadata: {
    issuer: google,
    openIdConnect: true,
    scopesSupported: ['openid', 'email', 'profile'],
    challengeMethods: ['plain', 'S256'],
  },
  openIdConfigurationAt: `${google}/.well-known/openid-configuration`,
  resource: null,
  parameters: { access_type: 'offline', prompt: 'consent' },
};
