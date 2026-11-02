import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { serveFakeApi } from '@on.auto/tool-servers/served-fakes';
import { describedAccess, patientTiming } from '@on.auto/tool-servers/testing';
import { Effect, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { providerNamed, readProviders, providersShippedRoots } from '../index.ts';

const providersOnDisk = shippedFilesOnDisk(providersShippedRoots());

const shipped = Result.getOrThrow(await readProviders(providersOnDisk));

const entriesFolder = new URL('../entries/', import.meta.url);

const { entry } = Result.getOrThrow(providerNamed(shipped, 'x'));

const clientSecret = 'x-org-app-secret-5e2a';

const user = '2244994945';

const post = '1346889436626259968';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function accessAtTheFake() {
  const fake = await serveFakeApi({ client: { clientId: 'org-app', clientSecret, expiresInSeconds: 7200 } });
  closing.push(fake.close);
  const { access } = await describedAccess(
    {
      x: {
        org: 'acme',
        document: relative(process.cwd(), fileURLToPath(new URL(entry.document ?? '', entriesFolder))),
        base_url: fake.baseUrl,
        auth: { issuer: String(fake.issuing?.issuer), client_id: 'org-app', client_secret: '${CLIENT_SECRET}' },
      },
    },
    { environment: { CLIENT_SECRET: clientSecret }, timing: patientTiming },
  );
  closing.push(access.close);
  return { fake, access };
}

interface Called {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const calls: readonly Called[] = [
  { tool: 'getUsersMe', input: { 'user.fields': ['username', 'public_metrics'] } },
  { tool: 'createPosts', input: { body: { text: 'Hello from a playbook' } } },
  { tool: 'deletePosts', input: { id: post } },
  { tool: 'getUsersPosts', input: { id: user, max_results: 10 } },
  { tool: 'getUsersMentions', input: { id: user, since_id: post } },
  { tool: 'searchPostsRecent', input: { query: 'from:XDevelopers -is:retweet', max_results: 10 } },
];

async function sentFor({ tool, input }: Called) {
  const { fake, access } = await accessAtTheFake();
  await Effect.runPromise(
    Effect.result(
      access.callOnce({ org: 'acme', playbook: 'alpha', reference: { server: 'x', tool }, input, meta: {} }),
    ),
  );
  return fake
    .seen()
    .filter(({ path }) => path.startsWith('/v1/'))
    .map(({ method, path, query, body }) => ({ method, path, query: decodeURIComponent(query), body }));
}

const reading = { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }, mark: 'reads' };

const posting = { annotations: { readOnlyHint: false, openWorldHint: true }, mark: 'acts' };

const deleting = {
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  mark: 'acts',
};

const aParagraphAfterTheSummary = /^\n\n[A-Z]/u;

function toolSaying(name: string, summary: string, marked: Readonly<Record<string, unknown>>): unknown {
  const described: unknown = expect.toSatisfy(
    (description: string) =>
      description.startsWith(summary) && aParagraphAfterTheSummary.test(description.slice(summary.length)),
  );
  return expect.objectContaining({ name, description: described, ...marked, marked_by: 'method' });
}

describe('the tools of x through its shipped document', () => {
  it('are the six operations the manifest keeps, each named and described in X’s words and marked by its method, those that read marked reads', async () => {
    const { access } = await accessAtTheFake();

    const listed = await Effect.runPromise(access.listServers({ org: 'acme', playbook: 'alpha' }));

    expect(listed).toEqual([
      expect.objectContaining({
        name: 'x',
        tools: [
          toolSaying('getUsersMe', 'Get My User', reading),
          toolSaying('createPosts', 'Create or Edit Post', posting),
          toolSaying('deletePosts', 'Delete Post', deleting),
          toolSaying('getUsersPosts', 'Get Posts', reading),
          toolSaying('getUsersMentions', 'Get Mentions', reading),
          toolSaying('searchPostsRecent', 'Search Recent Posts', reading),
        ],
      }),
    ]);
  });

  it('reach X at the paths of its API, an id in its segment and the fields and the search in the query', async () => {
    const sent = await Promise.all(calls.map((called) => sentFor(called)));

    expect(sent).toEqual([
      [{ method: 'GET', path: '/v1/2/users/me', query: '?user.fields=username,public_metrics', body: '' }],
      [{ method: 'POST', path: '/v1/2/tweets', query: '', body: JSON.stringify(calls[1]?.input['body']) }],
      [{ method: 'DELETE', path: `/v1/2/tweets/${post}`, query: '', body: '' }],
      [{ method: 'GET', path: `/v1/2/users/${user}/tweets`, query: '?max_results=10', body: '' }],
      [{ method: 'GET', path: `/v1/2/users/${user}/mentions`, query: `?since_id=${post}`, body: '' }],
      [
        {
          method: 'GET',
          path: '/v1/2/tweets/search/recent',
          query: '?query=from:XDevelopers+-is:retweet&max_results=10',
          body: '',
        },
      ],
    ]);
  });
});
