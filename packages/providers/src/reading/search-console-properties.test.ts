import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describedAccess, patientTiming, serveFakeApi } from '@on.auto/tool-servers/testing';
import { Effect, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { providerNamed, readProviders } from '../index.ts';

const page = readFileSync(new URL('../../../../docs/self-host/connections.md', import.meta.url), 'utf8');

const sentenceStart = page.indexOf('`google-search-console` reaches');

const sentence = page.slice(sentenceStart, page.indexOf('. ', sentenceStart));

const [, domainProperty = '', urlPrefixProperty = '', sentPath = ''] = [...sentence.matchAll(/`([^`]+)`/gu)].map(
  ([, quoted = '']: readonly string[]) => quoted,
);

const shipped = Result.getOrThrow(readProviders());

const { entry } = Result.getOrThrow(providerNamed(shipped, 'google-search-console'));

const clientSecret = 'search-console-secret-5e2a';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function pathSentFor(siteUrl: string): Promise<string | undefined> {
  const fake = await serveFakeApi({ client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600 } });
  closing.push(fake.close);
  const { access } = await describedAccess(
    {
      'search-console': {
        org: 'acme',
        document: relative(process.cwd(), join(shipped.documents, entry.document ?? '')),
        base_url: fake.baseUrl,
        auth: { issuer: String(fake.issuing?.issuer), client_id: 'playbook', client_secret: '${CLIENT_SECRET}' },
      },
    },
    { environment: { CLIENT_SECRET: clientSecret }, timing: patientTiming },
  );
  closing.push(access.close);
  await Effect.runPromise(
    access.callOnce({
      org: 'acme',
      playbook: 'alpha',
      reference: { server: 'search-console', tool: 'webmasters.sites.get' },
      input: { siteUrl },
      meta: {},
    }),
  );
  return fake
    .seen()
    .map(({ path }) => path)
    .find((path) => path.startsWith('/v1/webmasters/'));
}

describe('the properties of Search Console the connections page names', () => {
  it('are the two kinds of property, each named in the entry as the page names it', () => {
    expect([domainProperty, urlPrefixProperty]).toEqual(['sc-domain:example.com', 'https://www.example.com/']);
    expect(entry.description).toContain(domainProperty);
    expect(entry.description).toContain(urlPrefixProperty);
  });

  it('each reach the API through the shipped document, the URL-prefix property encoded in one segment as the page shows', async () => {
    const sent = await Promise.all([domainProperty, urlPrefixProperty].map((property) => pathSentFor(property)));

    expect(sent).toEqual([
      '/v1/webmasters/v3/sites/sc-domain%3Aexample.com',
      '/v1/webmasters/v3/sites/https%3A%2F%2Fwww.example.com%2F',
    ]);
    expect(sent[1]).toBe(`/v1/webmasters/v3/${sentPath}`);
  });
});
