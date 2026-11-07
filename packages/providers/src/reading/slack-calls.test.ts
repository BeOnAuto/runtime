import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { serveFakeApi, type FakeApiServer } from '@on.auto/tool-servers/served-fakes';
import { describedAccess, patientTiming } from '@on.auto/tool-servers/testing';
import { Effect, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { providerNamed, readProviders, providersShippedRoots } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const entriesFolder = new URL('../entries/', import.meta.url);

const { entry: slack } = Result.getOrThrow(providerNamed(shipped, 'slack'));

const { entry: slackBot } = Result.getOrThrow(providerNamed(shipped, 'slack-bot'));

const clientSecret = 'slack-secret-9e2b';

const botToken = 'slack-bot-token-4c8d1f';

const channel = 'C012AB3CD';

const ts = '1700000000.000100';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Called {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const calls: readonly Called[] = [
  { tool: 'auth_test', input: {} },
  { tool: 'conversations_list', input: { types: 'public_channel', limit: 200 } },
  { tool: 'conversations_info', input: { channel } },
  { tool: 'conversations_history', input: { channel, limit: 15 } },
  { tool: 'conversations_replies', input: { channel, ts } },
  { tool: 'users_list', input: { limit: 100 } },
  { tool: 'users_info', input: { user: 'U012AB3CD' } },
  { tool: 'chat_postMessage', input: { body: { channel, text: 'The digest is ready.' } } },
  { tool: 'chat_update', input: { body: { channel, ts, text: 'The digest is out.' } } },
  { tool: 'reactions_add', input: { body: { channel, name: 'thumbsup', timestamp: ts } } },
  { tool: 'reactions_get', input: { channel, timestamp: ts, full: true } },
];

const sentByEach: readonly Sent[] = [
  ['GET', '/v1/auth.test', '', ''],
  ['GET', '/v1/conversations.list', '?limit=200&types=public_channel', ''],
  ['GET', '/v1/conversations.info', `?channel=${channel}`, ''],
  ['GET', '/v1/conversations.history', `?channel=${channel}&limit=15`, ''],
  ['GET', '/v1/conversations.replies', `?channel=${channel}&ts=${ts}`, ''],
  ['GET', '/v1/users.list', '?limit=100', ''],
  ['GET', '/v1/users.info', '?user=U012AB3CD', ''],
  ['POST', '/v1/chat.postMessage', '', JSON.stringify({ channel, text: 'The digest is ready.' })],
  ['POST', '/v1/chat.update', '', JSON.stringify({ channel, ts, text: 'The digest is out.' })],
  ['POST', '/v1/reactions.add', '', JSON.stringify({ channel, name: 'thumbsup', timestamp: ts })],
  ['GET', '/v1/reactions.get', `?channel=${channel}&full=true&timestamp=${ts}`, ''],
];

const readingOnInWords: unknown = expect.stringMatching(
  /Slack returns at most 15 messages a call to an app distributed outside the Slack Marketplace.+call again with cursor set to the response_metadata\.next_cursor of the last answer/u,
);

function toolReadingOn(name: string): unknown {
  return expect.objectContaining({ name, description: readingOnInWords });
}

const document = relative(process.cwd(), fileURLToPath(new URL(slack.document ?? '', entriesFolder)));

type Answered = Parameters<FakeApiServer['answerNextWith']>[0];

function failedWith(error: string, headers: Readonly<Record<string, string>> = {}): Answered {
  return {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
    body: `{"ok":false,"error":"${error}"}`,
  };
}

interface Reached {
  readonly fake: FakeApiServer;
  readonly access: Awaited<ReturnType<typeof describedAccess>>['access'];
  readonly server: string;
}

async function asThePerson(): Promise<Reached> {
  const fake = await serveFakeApi({ client: { clientId: 'slack', clientSecret, expiresInSeconds: 3600 } });
  closing.push(fake.close);
  const { access } = await describedAccess(
    {
      slack: {
        org: 'acme',
        document,
        base_url: fake.baseUrl,
        failure_codes: slack.failure_codes,
        auth: { issuer: String(fake.issuing?.issuer), client_id: 'slack', client_secret: '${CLIENT_SECRET}' },
      },
    },
    { environment: { CLIENT_SECRET: clientSecret }, timing: patientTiming },
  );
  closing.push(access.close);
  return { fake, access, server: 'slack' };
}

async function asTheBot(): Promise<Reached> {
  const fake = await serveFakeApi({ key: botToken });
  closing.push(fake.close);
  const { access } = await describedAccess(
    {
      'slack-bot': {
        org: 'acme',
        document,
        base_url: fake.baseUrl,
        failure_codes: slackBot.failure_codes,
        security: { bot_token: '${SLACK_BOT_TOKEN}' },
      },
    },
    { environment: { SLACK_BOT_TOKEN: botToken }, timing: patientTiming },
  );
  closing.push(access.close);
  return { fake, access, server: 'slack-bot' };
}

function listedBy({ access }: Reached) {
  return access.listServers({ org: 'acme', playbook: 'alpha' });
}

function called({ access, server }: Reached, { tool, input }: Called) {
  return Effect.runPromise(
    access.callOnce({ org: 'acme', playbook: 'alpha', reference: { server, tool }, input, meta: {} }),
  );
}

type Sent = readonly [method: string, path: string, query: string, body: string];

function byPath([, one]: Sent, [, other]: Sent): number {
  return one.localeCompare(other);
}

interface Reaching {
  readonly sent: readonly Sent[];
  readonly bearers: ReadonlySet<string | undefined>;
}

async function sentThrough(reached: Reached, made: readonly Called[]): Promise<Reaching> {
  await Promise.all(made.map((each) => called(reached, each)));
  const seen = reached.fake.seen().filter(({ path }) => path.startsWith('/v1/'));
  return {
    sent: seen.map(({ method, path, query, body }): Sent => [method, path, query, body]).toSorted(byPath),
    bearers: new Set(seen.map(({ headers }) => headers['authorization'])),
  };
}

describe('the two Slack providers', () => {
  it('share the one document of the Slack Web API, and read its failed answers by the same codes', () => {
    expect([slack.document, slackBot.document]).toEqual([
      'documents/slack.openapi.json',
      'documents/slack.openapi.json',
    ]);
    expect(slack.failure_codes).toEqual(slackBot.failure_codes);
  });

  it('offer the person its eleven methods as tools, those that read marked read-only and those that post, update or react not', async () => {
    const [listed] = await Effect.runPromise(listedBy(await asThePerson()));

    expect(listed).toMatchObject({
      name: 'slack',
      tools: calls.map(({ tool }) => ({
        name: tool,
        annotations: { readOnlyHint: !['chat_postMessage', 'chat_update', 'reactions_add'].includes(tool) },
      })),
    });
  });

  it('offer the bot the same eleven tools as the person', async () => {
    const [listed] = await Effect.runPromise(listedBy(await asTheBot()));

    expect(listed).toMatchObject({ name: 'slack-bot', tools: calls.map(({ tool }) => ({ name: tool })) });
  });

  it('say on the history of a conversation and of a thread that Slack returns 15 messages a call outside its Marketplace, and how to read on', async () => {
    const [listed] = await Effect.runPromise(listedBy(await asThePerson()));
    const theTwoReads: unknown = expect.arrayContaining([
      toolReadingOn('conversations_history'),
      toolReadingOn('conversations_replies'),
    ]);

    expect(listed).toMatchObject({ name: 'slack', tools: theTwoReads });
  });
});

describe('the calls of slack and slack-bot through their shipped document', () => {
  it('reach the Web API at the path of each method, with the user token of the person or the bot token of the app as a bearer', async () => {
    const asPerson = await sentThrough(await asThePerson(), calls);
    const asBot = await sentThrough(await asTheBot(), calls);

    expect([asPerson.sent, asBot.sent]).toEqual([sentByEach.toSorted(byPath), sentByEach.toSorted(byPath)]);
    expect([asPerson.bearers, asBot.bearers]).toEqual([
      new Set([expect.stringMatching(/^Bearer token-1-/u)]),
      new Set([`Bearer ${botToken}`]),
    ]);
  });
});

describe('the answers of Slack that say a call failed', () => {
  it('end the token where Slack refused it, a second refusal being a key refused, in words that name the code', async () => {
    const person = await asThePerson();
    await called(person, { tool: 'auth_test', input: {} });

    person.fake.answerNextWith(failedWith('token_revoked'), 2);
    const refused = await called(person, { tool: 'auth_test', input: {} });

    expect(refused).toMatchObject({ outcome: 'server_failure', detail: 'The tool server answered token_revoked' });
    expect(person.fake.issuing?.tokenRequests()).toBe(2);
  });

  it('are a lacking scope, a limited rate waited out where it fits, or an error result naming the code, and never a success', async () => {
    const person = await asThePerson();
    const history = { tool: 'conversations_history', input: { channel } };

    person.fake.answerNextWith(failedWith('missing_scope'));
    const lacking = await called(person, history);
    person.fake.answerNextWith(failedWith('ratelimited', { 'retry-after': '0' }));
    person.fake.answerNextWith({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true,"messages":[]}',
    });
    const waited = await called(person, history);
    person.fake.answerNextWith(failedWith('channel_not_found'));
    const missing = await called(person, history);

    expect([lacking, waited, missing]).toMatchObject([
      {
        outcome: 'server_failure',
        detail:
          'The tool server answered missing_scope: the credential lacks a scope this request needs; a credential granted that scope would allow it',
      },
      { outcome: 'result', answer: { structuredContent: { ok: true, messages: [] } } },
      { outcome: 'tool_error', detail: '{"ok":false,"error":"channel_not_found"}' },
    ]);
  });
});
