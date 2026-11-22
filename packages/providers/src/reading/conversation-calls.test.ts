import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderedArguments, textAt } from '@on.auto/definitions/tool-blocks';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { answerDocument, toolBounds, type CalledOnce } from '@on.auto/tool-servers';
import { describedAccess, fakeApiInProcess, patientTiming } from '@on.auto/tool-servers/testing';
import { Effect, Option, Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  conversationsOf,
  conversationTemplates,
  providerNamed,
  providersShippedRoots,
  readProviders,
  typingShownThrough,
  type Conversations,
  type ProviderEntry,
} from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const entriesFolder = new URL('../entries/', import.meta.url);

const clientSecret = 'chat-secret-7d1e';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly body: string;
}

type Typing = NonNullable<Conversations['typing']>;

interface Reached {
  readonly seen: () => readonly (readonly [string, string, string])[];
  readonly answerNextWith: (body: string) => void;
  readonly called: (tool: string, written: Readonly<Record<string, Schema.Json>>) => Promise<CalledOnce>;
  readonly shown: (typing: Typing) => Promise<string>;
}

function inputOf(written: Readonly<Record<string, Schema.Json>>) {
  return Result.getOrThrow(renderedArguments(written, conversationTemplates.sample, () => 0, toolBounds.requestBytes))
    .input;
}

function schemeKeyOf({ credentials }: ProviderEntry): string | undefined {
  const [way] = credentials;
  return way?.kind === 'secret' && way.in === 'security' ? way.name : undefined;
}

type Access = Awaited<ReturnType<typeof describedAccess>>['access'];

function shownThrough(access: Access, connection: string, failureCodes: ProviderEntry['failure_codes']) {
  const repliedIn = { to: 'ada', sent: { conversation: 'C0123', id: '1699.1' }, reply: { id: '1699.2', to: '1699.1' } };
  const through = { callOnce: access.callOnce, mostRequestBytesTo: () => toolBounds.requestBytes };
  const asked = { org: 'acme', playbook: 'alpha', connection, failureCodes, repliedIn };
  return (typing: Typing) => Effect.runPromise(typingShownThrough(through, { ...asked, typing }));
}

async function reachedThrough(name: string): Promise<Reached> {
  const { entry } = Result.getOrThrow(providerNamed(shipped, name));
  const scheme = schemeKeyOf(entry);
  const fake = fakeApiInProcess(
    scheme === undefined ? { client: { clientId: name, clientSecret, expiresInSeconds: 3600 } } : { key: clientSecret },
  );
  closing.push(fake.close);
  const credential =
    scheme === undefined
      ? { auth: { issuer: String(fake.issuing?.issuer), client_id: name, client_secret: '${CLIENT_SECRET}' } }
      : { security: { [scheme]: '${CLIENT_SECRET}' } };
  const document = relative(process.cwd(), fileURLToPath(new URL(entry.document ?? '', entriesFolder)));
  const { access } = await describedAccess(
    {
      [name]: {
        org: 'acme',
        document,
        base_url: fake.baseUrl,
        ...(entry.failure_codes === undefined ? {} : { failure_codes: entry.failure_codes }),
        ...credential,
      },
    },
    { environment: { CLIENT_SECRET: clientSecret }, timing: patientTiming },
  );
  closing.push(access.close);
  return {
    seen: () =>
      fake
        .seen()
        .filter(({ path }: Seen) => path.startsWith('/v1/'))
        .map(({ method, path, body }: Seen) => [method, path, body] as const),
    answerNextWith: (body) => {
      fake.answerNextWith({ status: 200, headers: { 'content-type': 'application/json' }, body });
    },
    called: (tool, written) =>
      Effect.runPromise(
        access.callOnce({
          org: 'acme',
          playbook: 'alpha',
          reference: { server: name, tool },
          input: inputOf(written),
          meta: {},
        }),
      ),
    shown: shownThrough(access, name, entry.failure_codes),
  };
}

function postedId(called: CalledOnce, pointer: string): string | undefined {
  const answered = called.kind === 'answered' && called.outcome === 'result' ? called.answer : undefined;
  return answered === undefined ? undefined : textAt(answerDocument(answered), pointer);
}

function partOf(name: string) {
  const { reply, react } = Option.getOrThrow(Option.fromNullishOr(conversationsOf(shipped, name)));
  return { reply, react: Option.getOrThrow(Option.fromNullishOr(react)) };
}

describe('a line and a mark through the shipped parts', () => {
  it('reach Slack as a reply in the thread of the message the reply answers and a check mark on the reply, the line known by its ts', async () => {
    const { reply, react } = partOf('slack-bot');
    const slack = await reachedThrough('slack-bot');
    slack.answerNextWith('{"ok":true,"channel":"C0123","ts":"1699.3"}');
    slack.answerNextWith('{"ok":true}');

    const lined = await slack.called(reply.tool, reply.with);
    await slack.called(react.tool, react.with);

    expect(slack.seen()).toEqual([
      ['POST', '/v1/chat.postMessage', JSON.stringify({ channel: 'C0123', thread_ts: '1699.1', text: 'A line' })],
      [
        'POST',
        '/v1/reactions.add',
        JSON.stringify({ channel: 'C0123', timestamp: '1699.2', name: 'white_check_mark' }),
      ],
    ]);
    expect(postedId(lined, reply.sent)).toBe('1699.3');
  });

  it('reach Teams as a new message in the chat of the request, known by its id', async () => {
    const { reply } = Option.getOrThrow(Option.fromNullishOr(conversationsOf(shipped, 'microsoft-teams')));
    const teams = await reachedThrough('microsoft-teams');
    teams.answerNextWith('{"id":"1700000000003","chatId":"C0123"}');

    const lined = await teams.called(reply.tool, reply.with);

    expect(teams.seen()).toEqual([
      ['POST', '/v1/chats/C0123/messages', JSON.stringify({ body: { content: 'A line' } })],
    ]);
    expect(postedId(lined, reply.sent)).toBe('1700000000003');
  });

  it('read no id from a call that failed', async () => {
    const { reply } = partOf('slack-bot');
    const slack = await reachedThrough('slack-bot');
    slack.answerNextWith('{"ok":false,"error":"channel_not_found"}');

    expect(postedId(await slack.called(reply.tool, reply.with), reply.sent)).toBeUndefined();
  });
});

function typingOf(name: string): Typing {
  return Option.getOrThrow(Option.fromNullishOr(conversationsOf(shipped, name)?.typing));
}

const decodeBody = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)));

describe('a working status through the shipped part', () => {
  it('reaches Slack as the status of the thread a reply is in, with the words of the entry and nothing else, shown where Slack answers ok', async () => {
    const slack = await reachedThrough('slack-bot');
    slack.answerNextWith('{"ok":true}');

    const shown = await slack.shown(typingOf('slack-bot'));
    const bodies = slack.seen().map(([, , body]) => decodeBody(body));

    expect([shown, slack.seen().map(([method, path]) => [method, path])]).toEqual([
      'shown',
      [['POST', '/v1/assistant.threads.setStatus']],
    ]);
    expect(bodies).toEqual([expect.objectContaining({ channel_id: 'C0123', thread_ts: '1699.1' })]);
    expect(bodies.map((body) => Object.keys(body).toSorted())).toEqual([
      ['channel_id', 'loading_messages', 'status', 'thread_ts'],
    ]);
  });

  it.each([
    ['an error of its own that the entry lists', 'feature_disabled', 'refused'],
    ['a lacking scope, which the entry lists whole', 'missing_scope', 'refused'],
    ['a refused token, every code of which the entry lists', 'invalid_auth', 'refused'],
    ['an error of its own that the entry does not list', 'channel_not_found', 'failed'],
  ] as const)('where Slack answers %s, %s, is read as %s', async (_, code, read) => {
    const slack = await reachedThrough('slack-bot');
    slack.answerNextWith(JSON.stringify({ ok: false, error: code }));

    expect(await slack.shown(typingOf('slack-bot'))).toBe(read);
  });
});
