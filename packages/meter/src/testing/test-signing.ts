import { createPrivateKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { autoSigners, type Signed, type Signers } from '../licensing/signed-answers.ts';

const testKid = 'test-2026-10';

const testKey = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'bN0FUQIHQooD6e7KmtvYk5h81CGLqmKC5uYdb9P2dL0',
  d: 'NCNDNroPNqm9JnT08z6rFmdDEbHUyJFfk-nOZAXSdgU',
};

export const testSigners: Signers = new Map([...autoSigners, [testKid, testKey.x]]);

type Signing = (payload: object) => Signed;

function signingBy(privateKey: () => KeyObject, kid: string): Signing {
  return (payload) => {
    const text = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = sign(null, Buffer.from(text, 'utf8'), privateKey()).toString('base64url');
    return { payload: text, signature, kid };
  };
}

const theTestKey = createPrivateKey({ key: testKey, format: 'jwk' });

export const signedByTheTestKey: Signing = signingBy(() => theTestKey, testKid);

export function signedByAnotherKey(kid: string = testKid): Signing {
  const { privateKey } = generateKeyPairSync('ed25519');
  return signingBy(() => privateKey, kid);
}
