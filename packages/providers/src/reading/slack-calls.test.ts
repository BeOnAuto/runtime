import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import type { FakeApiServer } from '@on.auto/tool-servers/served-fakes';
import { describedAccess, fakeApiInProcess, patientTiming } from '@on.auto/tool-servers/testing';
import { Effect, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { providerNamed, readProviders, providersShippedRoots } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const entriesFolder = new URL('../entries/', import.meta.url);

const { entry: slackBot } = Result.getOrThrow(providerNamed(shipped, 'slack-bot'));

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
  {
    tool: 'assistant_threads_setStatus',
    input: { body: { channel_id: channel, thread_ts: ts, status: 'is thinking', loading_messages: ['Thinking…'] } },
  },
  { tool: 'chat_postEphemeral', input: { body: { channel, user: 'U012AB3CD', text: 'Only you see this.' } } },
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
  [
    'POST',
    '/v1/assistant.threads.setStatus',
    '',
    JSON.stringify({ channel_id: channel, thread_ts: ts, status: 'is thinking', loading_messages: ['Thinking…'] }),
  ],
  ['POST', '/v1/chat.postEphemeral', '', JSON.stringify({ channel, user: 'U012AB3CD', text: 'Only you see this.' })],
];

const readingOnInWords: unknown = expect.stringMatching(
  /Slack returns at most 15 messages a call to an app distributed outside the Slack Marketplace.+call again with cursor set to the response_metadata\.next_cursor of the last answer/u,
);

function toolReadingOn(name: string): unknown {
  return expect.objectContaining({ name, description: readingOnInWords });
}

const document = relative(process.cwd(), fileURLToPath(new URL(slackBot.document ?? '', entriesFolder)));

type Answered = Parameters<FakeApiServer['answerNextWith']>[0];

function failedWith(error: string, headers: Readonly<Record<string, string>> = {}): Answered {
  return {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
    body: `{"ok":false,"error":"${error}"}`,
  };
}

function answeredWith(body: unknown): Answered {
  return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

const address = 'spengler@ghostbusters.example.com';

const memberOf = (id: string) => ({
  id,
  team_id: 'T012AB3CD',
  name: 'spengler',
  deleted: false,
  real_name: 'Egon Spengler',
  profile: {
    real_name: 'Egon Spengler',
    display_name: 'spengler',
    email: address,
    image_72: 'https://avatars.example/e.png',
  },
});

interface Reached {
  readonly fake: FakeApiServer;
  readonly access: Awaited<ReturnType<typeof describedAccess>>['access'];
  readonly server: string;
}

async function asTheBot(): Promise<Reached> {
  const fake = fakeApiInProcess({ key: botToken });
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

describe('the Slack Bot provider', () => {
  it('reads the document of the Slack Web API beside the entries, and its failed answers by Slack’s codes', () => {
    expect([slackBot.document, slackBot.failure_codes]).toEqual([
      'documents/slack.openapi.json',
      {
        succeeded: '/ok',
        code: '/error',
        key_refused: [
          'invalid_auth',
          'not_authed',
          'token_revoked',
          'token_expired',
          'account_inactive',
          'not_allowed_token_type',
        ],
        scope_lacking: ['missing_scope'],
        rate_limited: ['ratelimited', 'rate_limited'],
      },
    ]);
  });

  it('offers the bot its thirteen methods as tools, those that read marked read-only and those that post, update, react or show a status not', async () => {
    const [listed] = await Effect.runPromise(listedBy(await asTheBot()));
    const acting = new Set([
      'chat_postMessage',
      'chat_update',
      'reactions_add',
      'assistant_threads_setStatus',
      'chat_postEphemeral',
    ]);

    expect(listed).toMatchObject({
      name: 'slack-bot',
      tools: calls.map(({ tool }) => ({ name: tool, annotations: { readOnlyHint: !acting.has(tool) } })),
    });
  });

  it('says on the history of a conversation and of a thread that Slack returns 15 messages a call outside its Marketplace, and how to read on', async () => {
    const [listed] = await Effect.runPromise(listedBy(await asTheBot()));
    const theTwoReads: unknown = expect.arrayContaining([
      toolReadingOn('conversations_history'),
      toolReadingOn('conversations_replies'),
    ]);

    expect(listed).toMatchObject({ name: 'slack-bot', tools: theTwoReads });
  });
});

describe('the calls of slack-bot through its shipped document', () => {
  it('reach the Web API at the path of each method, with the bot token of the app as a bearer', async () => {
    const asBot = await sentThrough(await asTheBot(), calls);

    expect([asBot.sent, asBot.bearers]).toEqual([sentByEach.toSorted(byPath), new Set([`Bearer ${botToken}`])]);
  });
});

describe('a member’s email address, which Slack answers in a user object to an app granted users:read.email', () => {
  it('reaches a function through Slack Bot as Slack answered it, since the document of a company’s own app declares nothing of it', async () => {
    const bot = await asTheBot();
    bot.fake.answerNextWith(answeredWith({ ok: true, user: memberOf('W012A3CDE') }));
    bot.fake.answerNextWith(
      answeredWith({
        ok: true,
        members: [memberOf('W012A3CDE'), memberOf('W07QCRPA4')],
        response_metadata: { next_cursor: '' },
      }),
    );

    const person = await called(bot, { tool: 'users_info', input: { user: 'W012A3CDE' } });
    const directory = await called(bot, { tool: 'users_list', input: { limit: 100 } });

    expect([person, directory]).toMatchObject([
      { outcome: 'result', answer: { structuredContent: { ok: true, user: memberOf('W012A3CDE') } } },
      {
        outcome: 'result',
        answer: {
          structuredContent: {
            ok: true,
            members: [memberOf('W012A3CDE'), memberOf('W07QCRPA4')],
            response_metadata: { next_cursor: '' },
          },
        },
      },
    ]);
    expect(JSON.stringify(person)).toContain(address);
  });
});

describe('the answers of Slack that say a call failed', () => {
  it('are a key refused where Slack refused the bot token, in words that name the code', async () => {
    const bot = await asTheBot();

    bot.fake.answerNextWith(failedWith('token_revoked'));
    const refused = await called(bot, { tool: 'auth_test', input: {} });

    expect(refused).toMatchObject({ outcome: 'server_failure', detail: 'The tool server answered token_revoked' });
  });

  it('are a lacking scope, a limited rate waited out where it fits, or an error result naming the code, and never a success', async () => {
    const bot = await asTheBot();
    const history = { tool: 'conversations_history', input: { channel } };

    bot.fake.answerNextWith(failedWith('missing_scope'));
    const lacking = await called(bot, history);
    bot.fake.answerNextWith(failedWith('ratelimited', { 'retry-after': '0' }));
    bot.fake.answerNextWith({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true,"messages":[]}',
    });
    const waited = await called(bot, history);
    bot.fake.answerNextWith(failedWith('channel_not_found'));
    const missing = await called(bot, history);

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
