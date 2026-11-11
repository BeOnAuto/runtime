import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderedArguments, textAt } from '@on.auto/definitions/tool-blocks';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { answerDocument, type CalledOnce } from '@on.auto/tool-servers';
import { serveFakeApi } from '@on.auto/tool-servers/served-fakes';
import { describedAccess, patientTiming } from '@on.auto/tool-servers/testing';
import { Effect, Option, Result, type Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  conversationsOf,
  conversationTemplates,
  providerNamed,
  providersShippedRoots,
  readProviders,
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

interface Reached {
  readonly seen: () => readonly (readonly [string, string, string])[];
  readonly answerNextWith: (body: string) => void;
  readonly called: (tool: string, written: Readonly<Record<string, Schema.Json>>) => Promise<CalledOnce>;
}

function inputOf(written: Readonly<Record<string, Schema.Json>>) {
  return Result.getOrThrow(renderedArguments(written, conversationTemplates.sample, () => 0)).input;
}

async function reachedThrough(name: string): Promise<Reached> {
  const { entry } = Result.getOrThrow(providerNamed(shipped, name));
  const fake = await serveFakeApi({ client: { clientId: name, clientSecret, expiresInSeconds: 3600 } });
  closing.push(fake.close);
  const document = relative(process.cwd(), fileURLToPath(new URL(entry.document ?? '', entriesFolder)));
  const { access } = await describedAccess(
    {
      [name]: {
        org: 'acme',
        document,
        base_url: fake.baseUrl,
        ...(entry.failure_codes === undefined ? {} : { failure_codes: entry.failure_codes }),
        auth: { issuer: String(fake.issuing?.issuer), client_id: name, client_secret: '${CLIENT_SECRET}' },
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
    const { reply, react } = partOf('slack');
    const slack = await reachedThrough('slack');
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
    const { reply } = partOf('slack');
    const slack = await reachedThrough('slack');
    slack.answerNextWith('{"ok":false,"error":"channel_not_found"}');

    expect(postedId(await slack.called(reply.tool, reply.with), reply.sent)).toBeUndefined();
  });
});
