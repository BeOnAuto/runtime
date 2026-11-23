import { memoryLedger } from '@on.auto/operations/testing';
import { sealedSecretStoreOn } from '@on.auto/secrets';
import { memoryRows, recordingCustodian } from '@on.auto/secrets/testing';
import { DateTime, Effect, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { issuerPath, subjectTokenIssuerOf, subjectTokensServedBy } from './served-subject-tokens.ts';
import { madeRsaSigningKey, subjectTokenKeyDecider, subjectTokenKeyStream } from './subject-token-key.ts';

const now = Effect.map(DateTime.now, DateTime.toEpochMillis);

const publicUrl = 'https://runtime.example.com';

const key = await madeRsaSigningKey();

function anIssuerOver(given: string | undefined) {
  const ledger = memoryLedger();
  const rows = memoryRows({ now });
  const secrets = sealedSecretStoreOn(rows, { current: recordingCustodian() });
  const served = Effect.runPromise(
    subjectTokensServedBy(given, { registry: ledger.service, secrets, made: () => Promise.resolve(key) }),
  );
  return { ledger, rows, served };
}

const Fields = Schema.Record(Schema.String, Schema.Unknown);

const fieldsOf = Schema.decodeUnknownSync(Fields);

const fieldsOfJson = Schema.decodeUnknownSync(Schema.fromJsonString(Fields));

const KeySet = Schema.Struct({ keys: Schema.Tuple([Fields]) });

function fieldsOfAPart(part: string): Readonly<Record<string, unknown>> {
  return fieldsOfJson(Buffer.from(part, 'base64url').toString());
}

async function documentsOf(given: string) {
  const { issuing, answers } = await anIssuerOver(given).served;
  const [metadata, keySet] = await Promise.all(answers.map(({ answer }) => answer().json()));
  const [published] = Schema.decodeUnknownSync(KeySet)(keySet).keys;
  return {
    issuing: Option.getOrThrow(Option.fromNullishOr(issuing)),
    answers,
    metadata: fieldsOf(metadata),
    published,
  };
}

describe('the issuer of subject tokens of a runtime with no https PUBLIC_URL', () => {
  it.each([
    [undefined, undefined],
    ['http://localhost:5555', undefined],
    ['http://127.0.0.1:5555', undefined],
    [publicUrl, `${publicUrl}${issuerPath}`],
  ])('of PUBLIC_URL %s is %s', (given, issuer) => {
    expect(subjectTokenIssuerOf(given)).toBe(issuer);
  });

  it.each([undefined, 'http://localhost:5555'])(
    'is absent where PUBLIC_URL is %s, so nothing is signed, no path is answered and no key is kept',
    async (given) => {
      const { ledger, rows, served } = anIssuerOver(given);

      const { issuing, answers } = await served;
      const { version } = await Effect.runPromise(ledger.service.load(subjectTokenKeyStream, subjectTokenKeyDecider));

      expect(issuing).toBeUndefined();
      expect(answers).toEqual([]);
      expect([version, rows.kept().length]).toEqual([0, 0]);
    },
  );
});

describe('the issuer of subject tokens of a runtime with an https PUBLIC_URL', () => {
  it('answers its metadata and its key set under /oidc, to a page of any origin', async () => {
    const { answers } = await documentsOf(publicUrl);

    const headers: readonly Readonly<Record<string, string>>[] = answers.map(({ answer }) =>
      Object.fromEntries(answer().headers),
    );

    expect(answers.map(({ path }) => path)).toEqual([
      '/oidc/.well-known/openid-configuration',
      '/oidc/.well-known/jwks.json',
    ]);
    expect(headers.map((fields) => fields['access-control-allow-origin'])).toEqual(['*', '*']);
    expect(headers.map((fields) => fields['content-type'])).toEqual(['application/json', 'application/json']);
  });

  it('signs a token for an organization, as the issuer its metadata names, by the key its key set names', async () => {
    const { issuing, metadata, published } = await documentsOf(publicUrl);

    const token = await issuing.signedFor({ org: 'org_2b7Kq', audience: 'https://sts.example.com' });
    const [header, payload] = token
      .split('.')
      .slice(0, 2)
      .map((part) => fieldsOfAPart(part));

    expect(metadata).toMatchObject({
      issuer: `${publicUrl}/oidc`,
      jwks_uri: `${publicUrl}/oidc/.well-known/jwks.json`,
    });
    expect(header).toMatchObject({ alg: 'RS256', kid: published['kid'] });
    expect(payload).toMatchObject({ iss: `${publicUrl}/oidc`, sub: 'org_2b7Kq', aud: 'https://sts.example.com' });
  });

  it('publishes the public half of the key it keeps alone', async () => {
    const { published } = await documentsOf(publicUrl);

    expect(Object.keys(published).toSorted()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
    expect(Object.keys(key).filter((member) => Object.hasOwn(published, member))).toEqual(['kty', 'n', 'e']);
  });
});
