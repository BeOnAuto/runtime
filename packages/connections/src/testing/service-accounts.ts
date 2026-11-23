import { generateKeyPairSync } from 'node:crypto';

import type { ProviderList } from '@on.auto/providers';
import {
  asAServiceAccount,
  asTheServiceAccountItself as wayOfTheServiceAccountItself,
  mail,
  providerListOf,
  providerOf,
  signingInToMail,
} from '@on.auto/providers/testing';
import { fakeMcpInProcess, type FakeMcpServer } from '@on.auto/tool-servers/testing';

export const robot = 'robot@acme.example.com';

export const inbox = 'inbox@acme.example.com';

export const otherPartsOfTheFile = { project_id: 'acme-mail-4f2a', private_key_id: 'c0ffee5e7b1d4a9e8f60' } as const;

export interface ServiceAccount {
  readonly issuer: FakeMcpServer;
  readonly providers: ProviderList;
  readonly keyFile: string;
  readonly privateKey: string;
}

interface Delegation {
  readonly subjects?: readonly string[];
  readonly namedIssuer?: string;
  readonly actsAsItself?: boolean;
}

function rsaKeys() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

export function serviceAccountAt({
  subjects = [inbox],
  namedIssuer,
  actsAsItself = false,
}: Delegation = {}): ServiceAccount {
  const { publicKey, privateKey } = rsaKeys();
  const named = namedIssuer === undefined ? {} : { issuer: namedIssuer };
  const issuer = fakeMcpInProcess({
    client: { clientId: robot, publicKey, expiresInSeconds: 3600, subjects, ...named },
  });
  const way = { ...(actsAsItself ? wayOfTheServiceAccountItself : asAServiceAccount), issuer: issuer.origin };
  const keyFile = JSON.stringify({
    type: 'service_account',
    ...otherPartsOfTheFile,
    private_key: privateKey,
    client_email: robot,
  });
  return {
    issuer,
    providers: providerListOf(providerOf({ ...mail, credentials: [signingInToMail, way] })),
    keyFile,
    privateKey,
  };
}

export const asTheServiceAccount = {
  provider: 'mail',
  credential: { kind: 'jwt_bearer' },
  placeholders: { inbox },
} as const;

export const asTheServiceAccountItself = { provider: 'mail', credential: { kind: 'jwt_bearer' } } as const;
