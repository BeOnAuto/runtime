import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { required } from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { serveFakeApi, type FakeApiServer } from '@on.auto/tool-servers/served-fakes';
import { describedAccess, patientTiming } from '@on.auto/tool-servers/testing';
import { Effect, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { providerNamed, readProviders, providersShippedRoots } from '../index.ts';

const providersOnDisk = shippedFilesOnDisk(providersShippedRoots());

const shipped = Result.getOrThrow(await readProviders(providersOnDisk));

const entriesFolder = new URL('../entries/', import.meta.url);

const { entry } = Result.getOrThrow(providerNamed(shipped, 'linkedin'));

const clientSecret = 'linkedin-secret-7c1d';

const member = 'urn:li:person:782bbtaQ';

const post = 'urn:li:share:6844785523593134080';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Called {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const calls: readonly Called[] = [
  { tool: 'get_userinfo', input: {} },
  {
    tool: 'create_post',
    input: {
      body: {
        author: member,
        commentary: 'Sample text Post',
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      },
    },
  },
  { tool: 'delete_post', input: { postUrn: post } },
  {
    tool: 'create_comment',
    input: { postUrn: post, body: { actor: member, object: post, message: { text: 'Test comment' } } },
  },
  { tool: 'create_reaction', input: { actor: member, body: { root: post, reactionType: 'LIKE' } } },
];

type Answered = Parameters<FakeApiServer['answerNextWith']>[0];

async function calledAtTheFake({ tool, input }: Called, answered?: Answered) {
  const fake = await serveFakeApi({ client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600 } });
  closing.push(fake.close);
  if (answered !== undefined) {
    fake.answerNextWith(answered);
  }
  const { access } = await describedAccess(
    {
      linkedin: {
        org: 'acme',
        document: relative(process.cwd(), fileURLToPath(new URL(entry.document ?? '', entriesFolder))),
        base_url: fake.baseUrl,
        headers: entry.headers,
        auth: { issuer: String(fake.issuing?.issuer), client_id: 'playbook', client_secret: '${CLIENT_SECRET}' },
      },
    },
    { environment: { CLIENT_SECRET: clientSecret }, timing: patientTiming },
  );
  closing.push(access.close);
  const called = await Effect.runPromise(
    Effect.result(
      access.callOnce({ org: 'acme', playbook: 'alpha', reference: { server: 'linkedin', tool }, input, meta: {} }),
    ),
  );
  return { fake, called };
}

async function sentFor(called: Called) {
  const { fake } = await calledAtTheFake(called);
  return fake
    .seen()
    .filter(({ path }) => path.startsWith('/v1/'))
    .map(({ method, path, query, headers, body }) => ({
      method,
      path,
      query,
      versions: [headers['linkedin-version'], headers['x-restli-protocol-version']],
      body,
    }));
}

describe('the calls of linkedin through its shipped document', () => {
  it('reach LinkedIn at the paths its references write, a URN encoded in one segment or in the query, with the version headers of the entry', async () => {
    const sent = await Promise.all(calls.map((called) => sentFor(called)));
    const versions = ['202610', '2.0.0'];

    expect(sent).toEqual([
      [{ method: 'GET', path: '/v1/v2/userinfo', query: '', versions, body: '' }],
      [{ method: 'POST', path: '/v1/rest/posts', query: '', versions, body: JSON.stringify(calls[1]?.input['body']) }],
      [
        {
          method: 'DELETE',
          path: '/v1/rest/posts/urn%3Ali%3Ashare%3A6844785523593134080',
          query: '',
          versions,
          body: '',
        },
      ],
      [
        {
          method: 'POST',
          path: '/v1/rest/socialActions/urn%3Ali%3Ashare%3A6844785523593134080/comments',
          query: '',
          versions,
          body: JSON.stringify(calls[3]?.input['body']),
        },
      ],
      [
        {
          method: 'POST',
          path: '/v1/rest/reactions',
          query: '?actor=urn%3Ali%3Aperson%3A782bbtaQ',
          versions,
          body: JSON.stringify(calls[4]?.input['body']),
        },
      ],
    ]);
  });
});

describe('the post linkedin creates', () => {
  it('is answered by its URN, which LinkedIn writes in the x-restli-id header of an empty answer', async () => {
    const created = { status: 201, headers: { 'x-restli-id': post }, body: '' };

    const { called } = await calledAtTheFake(required(calls[1]), created);

    expect(called).toMatchObject({
      success: {
        answer: {
          content: [{ type: 'text', text: `{"headers":{"x-restli-id":"${post}"}}` }],
          structuredContent: { headers: { 'x-restli-id': post } },
        },
      },
    });
  });
});
