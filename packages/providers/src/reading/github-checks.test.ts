import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import type { ConnectionRequest } from '@on.auto/tool-servers';
import { Effect, Option, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { listedEventOf } from '../events/arrival-readings.ts';
import type { Destination } from '../events/destination-fields.ts';
import {
  accountTypesOf,
  permissionsOf,
  providerNamed,
  providersShippedRoots,
  readProviders,
  subscriptionCallsOf,
  triggersAskerOf,
} from '../index.ts';
import { requestedWith } from '../testing/subscription-services.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const githubsDestinations = Result.getOrThrow(providerNamed(shipped, 'github')).entry.events?.destinations ?? [];

const ISSUE_OPENED = 'com.github.issues.opened';

const PULL_REQUEST_OPENED = 'com.github.pull_request.opened';

const checkOf = (type: string) =>
  Option.getOrThrow(
    Option.fromNullishOr(
      githubsDestinations.find(
        ({ type: way, events = [] }) => way === 'polling' && events.some((each) => each.type === type),
      ),
    ),
  );

const githubsCheck = checkOf(ISSUE_OPENED);

const theRead = Option.getOrThrow(Option.fromNullishOr(githubsCheck.read));

/** An issue as GitHub's GraphQL API answers it for the check, made up in its shape. */
const anIssueListed = {
  id: 'I_kwDOABCDEF5A1b2c',
  number: 1347,
  title: 'Found a bug',
  body: "I'm having a problem with this.",
  url: 'https://github.com/octo-org/hello-world/issues/1347',
  createdAt: '2026-11-20T09:00:00Z',
  repository: { nameWithOwner: 'octo-org/hello-world' },
  author: { __typename: 'User', login: 'octocat', databaseId: 1 },
};

const anIssueOfAnApp = {
  ...anIssueListed,
  id: 'I_kwDOABCDEF5A1b2d',
  number: 1349,
  createdAt: '2026-11-20T10:00:00Z',
  author: { __typename: 'Bot', login: 'octo-app' },
};

const theAnswer = {
  data: { repository: { issues: { nodes: [anIssueListed, anIssueOfAnApp], pageInfo: { endCursor: 'Y3Vyc29yOjI=' } } } },
};

const anIssueOpened = {
  type: 'com.github.issues.opened',
  id: 'com.github.issues.opened/I_kwDOABCDEF5A1b2c',
  time: '2026-11-20T09:00:00Z',
  subject: 'octo-org/hello-world',
  data: {
    number: 1347,
    title: 'Found a bug',
    body: "I'm having a problem with this.",
    author: 'octocat',
    html_url: 'https://github.com/octo-org/hello-world/issues/1347',
  },
  actor: '1',
};

const anIssueAnAppOpened = {
  ...anIssueOpened,
  id: 'com.github.issues.opened/I_kwDOABCDEF5A1b2d',
  time: '2026-11-20T10:00:00Z',
  data: { ...anIssueOpened.data, number: 1349, author: 'octo-app' },
  automatic: true,
  actor: undefined,
};

function sentFor(topic: string, pageToken = '', destination = githubsCheck) {
  const sent: ConnectionRequest[] = [];
  const calls = subscriptionCallsOf({
    callOnce: () => Effect.die('a tool was called'),
    requestOnce: (request) =>
      Effect.sync(() => {
        sent.push(request);
        return requestedWith(theAnswer);
      }),
    mostRequestBytesTo: () => 1_048_576,
    callbackOf: () => {},
  });
  const place = { org: 'acme', playbook: 'alpha', connection: 'github' };
  const read = Option.getOrThrow(Option.fromNullishOr(destination.read));
  const done = Effect.runSync(calls.read({ read, place, topic, since: '2026-11-20T08:00:00Z', pageToken }));
  return { done, addresses: sent.map(({ method, url }) => [method, url]), bodies: sent.map(({ body }) => body) };
}

const askedFor = (type: string, taken: readonly Destination[]) =>
  Effect.runSync(
    triggersAskerOf(() => Effect.succeed([{ connection: 'github', type, subject: 'octo-org/hello-world' }]))({
      org: 'acme',
      playbook: 'alpha',
      taken: new Map([['github', taken]]),
    }),
  ).map(({ topic, destination }) => [topic, destination.type]);

const listed: readonly Schema.Json[] = [anIssueListed, anIssueOfAnApp];

const eventsOfTheListed = listed.map((item) => listedEventOf(githubsCheck, item));

const aPullRequestListed = {
  ...anIssueListed,
  id: 'PR_kwDOABCDEF5A1b2e',
  number: 1350,
  title: 'Fix the bug',
  url: 'https://github.com/octo-org/hello-world/pull/1350',
};

describe('the checks of GitHub, for a runtime that takes no inbound connection', () => {
  it('come after the webhook, so a runtime that receives GitHub’s webhook is told at once and only one that cannot checks', () => {
    expect(githubsDestinations.map(({ type }) => type)).toEqual(['webhook', 'polling', 'polling']);
    expect([theRead.order, theRead.start, theRead.cursor, theRead.next_page_token]).toEqual([
      'newest_first',
      '{{ now }}',
      '/createdAt',
      '/data/repository/issues/pageInfo/endCursor',
    ]);
  });

  it('ask GitHub’s GraphQL API for the repository’s newest issues, a page at a time, its owner and name read from the place', () => {
    const first = sentFor('issues in octo-org/hello-world');
    const next = sentFor('issues in octo-org/hello-world', 'Y3Vyc29yOjI=');

    expect(first.addresses).toEqual([['POST', 'https://api.github.com/graphql']]);
    expect([...first.bodies, ...next.bodies]).toMatchObject([
      { variables: { owner: 'octo-org', name: 'hello-world', after: '' } },
      { variables: { owner: 'octo-org', name: 'hello-world', after: 'Y3Vyc29yOjI=' } },
    ]);
    expect(first.done).toMatchObject({ outcome: 'answered', document: theAnswer });
  });

  it('turn each issue listed into the event GitHub’s webhook reports for it, marked automatic where an app opened it', () => {
    expect(eventsOfTheListed).toEqual([anIssueOpened, anIssueAnAppOpened]);
  });
});

describe('the check of GitHub’s pull requests, and which check hears which type', () => {
  it('turns each pull request listed into the event GitHub’s webhook reports for it, read through its own check', () => {
    const pulls = checkOf(PULL_REQUEST_OPENED);
    const { bodies } = sentFor('pull requests in octo-org/hello-world', '', pulls);

    expect(bodies).toMatchObject([{ variables: { owner: 'octo-org', name: 'hello-world', after: '' } }]);
    expect([pulls.read?.list, pulls.read?.next_page_token]).toEqual([
      '/data/repository/pullRequests/nodes',
      '/data/repository/pullRequests/pageInfo/endCursor',
    ]);
    expect(listedEventOf(pulls, aPullRequestListed)).toEqual({
      ...anIssueOpened,
      type: PULL_REQUEST_OPENED,
      id: `${PULL_REQUEST_OPENED}/${aPullRequestListed.id}`,
      data: { ...anIssueOpened.data, number: 1350, title: 'Fix the bug', html_url: aPullRequestListed.url },
    });
  });

  it('hears each type only where the runtime takes no webhook, through its own check, and none a check cannot read', () => {
    const checks = githubsDestinations.slice(1);

    expect([
      askedFor(ISSUE_OPENED, githubsDestinations),
      askedFor(PULL_REQUEST_OPENED, githubsDestinations),
      askedFor(ISSUE_OPENED, checks),
      askedFor(PULL_REQUEST_OPENED, checks),
      askedFor('com.github.issue_comment.created', checks),
      askedFor('com.github.pull_request.closed', checks),
    ]).toEqual([
      [['octo-org/hello-world', 'webhook']],
      [['octo-org/hello-world', 'webhook']],
      [['issues in octo-org/hello-world', 'polling']],
      [['pull requests in octo-org/hello-world', 'polling']],
      [],
      [],
    ]);
  });
});

describe('the way of GitHub that connects as the company’s own GitHub App', () => {
  it('comes last, after the sign-in and the key, acts as the app, and asks its installation’s token of GitHub with a JWT the .pem file signs, naming the App ID', () => {
    const { entry } = Result.getOrThrow(providerNamed(shipped, 'github'));
    const ofTheApp = Option.getOrThrow(Option.fromNullishOr(entry.credentials.at(-1)));

    expect(entry.credentials.map(({ kind }) => kind)).toEqual([
      'authorization',
      'authorization',
      'secret',
      'jwt_bearer',
    ]);
    expect([permissionsOf(ofTheApp), accountTypesOf(ofTheApp)]).toEqual(['application', []]);
    expect(ofTheApp).toMatchObject({
      issuer: 'https://api.github.com',
      client_id: '{app_id}',
      key_file: { format: 'pem' },
      token_request: {
        method: 'POST',
        url: 'https://api.github.com/app/installations/{installation_id}/access_tokens',
        issued: { access_token: '/token', expires_at: '/expires_at' },
      },
    });
    expect(Object.keys(Option.getOrThrow(Option.fromNullishOr(ofTheApp.placeholders)))).toEqual([
      'app_id',
      'installation_id',
    ]);
    expect(ofTheApp.limitation).toBeDefined();
  });
});

describe('the way of GitHub that connects through the GitHub App whoever runs Auto registered', () => {
  it('comes first, acts as the app, signs in at GitHub with the registered client alone, takes an installation only where the person administers its account, and asks each installation’s token with the app’s key', () => {
    const { entry } = Result.getOrThrow(providerNamed(shipped, 'github'));
    const [first] = entry.credentials;
    const ofAutosApp = Option.getOrThrow(Option.fromNullishOr(first));

    expect([permissionsOf(ofAutosApp), accountTypesOf(ofAutosApp)]).toEqual(['application', []]);
    expect(ofAutosApp).toMatchObject({
      kind: 'authorization',
      issuer: 'https://github.com/login/oauth',
      clients: ['registered'],
      installation: {
        issuer: 'https://api.github.com',
        installations: {
          method: 'GET',
          list: '/installations',
          id: '/id',
          name: '/account/login',
          account: '/account/id',
          personal: { '/account/type': ['User'] },
        },
        userinfo: { method: 'GET', url: 'https://api.github.com/user', id: '/id' },
        membership: {
          method: 'GET',
          url: 'https://api.github.com/user/memberships/orgs/{account_name}',
          admin: { '/role': ['admin'], '/state': ['active'] },
        },
        returned: { installation: 'installation_id', requested: { setup_action: ['request'] } },
        token_request: {
          method: 'POST',
          url: 'https://api.github.com/app/installations/{installation_id}/access_tokens',
          issued: { access_token: '/token', expires_at: '/expires_at' },
        },
      },
    });
    expect([ofAutosApp.scope, ofAutosApp.placeholders, ofAutosApp.limitation === undefined]).toEqual([
      undefined,
      undefined,
      false,
    ]);
  });
});
