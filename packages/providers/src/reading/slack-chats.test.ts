import { renderedArguments } from '@on.auto/definitions/tool-blocks';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { chatMessageIn, eventDestinationOf, providerNamed, providersShippedRoots, readProviders } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const { entry: slackBot } = Result.getOrThrow(providerNamed(shipped, 'slack-bot'));

const overItsSocket = eventDestinationOf(shipped, 'slack-bot', 'websocket');

type Fields = Readonly<Record<string, Schema.Json>>;

const posted: Fields = {
  user: 'U0PERSON',
  text: 'How did the launch go?',
  ts: '1700000000.000200',
  channel: 'C0SUPPORT',
  team: 'T0WORKSPACE',
};

const unshared: Fields = { is_ext_shared_channel: false };

function framed(event: Fields, envelope: Fields = unshared) {
  const payload = { type: 'event_callback', team_id: 'T0WORKSPACE', ...envelope, event: { ...posted, ...event } };
  return { transport: 'message' as const, payload: { type: 'events_api', envelope_id: 'e1', payload } };
}

function readAsSlackSends(event: Fields, envelope?: Fields) {
  return overItsSocket === undefined ? undefined : chatMessageIn(overItsSocket, framed(event, envelope));
}

const mentioned = { type: 'app_mention', text: '<@U0AUTO> How did the launch go?' };

const inAChannel = { type: 'message', channel_type: 'channel' };

const inAThread = { ...inAChannel, thread_ts: '1700000000.000100' };

describe('a message a person wrote to Slack Bot, as its entry declares it', () => {
  it('is a mention where the app is named, in a channel or a thread, read with each place', () => {
    expect(readAsSlackSends(mentioned)).toEqual({
      kind: 'mention',
      id: '1700000000.000200',
      conversation: 'C0SUPPORT',
      sender: 'U0PERSON',
      account: 'T0WORKSPACE',
      text: '<@U0AUTO> How did the launch go?',
      time: '2023-11-14T22:13:20.000200Z',
      shared: false,
    });
    expect(readAsSlackSends({ ...mentioned, thread_ts: '1700000000.000100' })?.thread).toBe('1700000000.000100');
  });

  it.each([
    ['a direct message', { type: 'message', channel_type: 'im' }, 'direct_message'],
    ['a reply in a thread of a channel', inAThread, 'ambient'],
    ['a reply in a thread of a private channel', { ...inAThread, channel_type: 'group' }, 'ambient'],
  ] as const)('is read from %s as its kind', (_, event: Fields, kind) => {
    expect(readAsSlackSends(event)?.kind).toBe(kind);
  });

  it.each([
    ['a message in a channel outside a thread', inAChannel],
    ['a message of an app', { ...inAThread, bot_id: 'B0APP' }],
    ['a message an app posted as a bot', { ...inAThread, subtype: 'bot_message' }],
    ['an edit', { ...inAThread, subtype: 'message_changed', hidden: true }],
    ['a deletion', { type: 'message', channel_type: 'im', subtype: 'message_deleted', hidden: true }],
    ['a person joining the channel', { ...inAThread, subtype: 'channel_join' }],
    ['a message in a group direct message', { type: 'message', channel_type: 'mpim' }],
  ] as const)('is none for %s', (_, event: Fields) => {
    expect(readAsSlackSends(event)).toBeUndefined();
  });

  it('names the workspace of whoever wrote it, and says the channel is shared unless Slack says it is not', () => {
    expect([
      readAsSlackSends({ ...mentioned, user_team: 'T0OTHER' })?.account,
      readAsSlackSends({ type: 'message', channel_type: 'im', team: 'T0OTHER' })?.account,
      readAsSlackSends(mentioned, { is_ext_shared_channel: true })?.shared,
      readAsSlackSends(mentioned, {})?.shared,
    ]).toEqual(['T0OTHER', 'T0OTHER', true, true]);
  });
});

const aLine = 'The launch went well.';

const working = '1700000000.000300';

function renderedFor(event: Fields, written: Readonly<Record<string, Schema.Json>> | undefined) {
  const message = readAsSlackSends(event);
  const variables = { ...message, message: aLine, sent: { id: working } };
  return Result.map(
    renderedArguments(written ?? {}, variables, () => 0, 65_536),
    ({ input }) => input,
  );
}

describe('how Slack Bot answers a message a person wrote, as its entry declares it', () => {
  const { chat } = slackBot;

  it('posts the answer in the thread of the message, or under it where it started none, and replaces a message Auto posted', () => {
    expect([
      renderedFor(mentioned, chat?.answer.with),
      renderedFor(inAThread, chat?.answer.with),
      renderedFor(mentioned, chat?.answer.replace.with),
    ]).toEqual([
      Result.succeed({ body: { channel: 'C0SUPPORT', thread_ts: '1700000000.000200', text: aLine } }),
      Result.succeed({ body: { channel: 'C0SUPPORT', thread_ts: '1700000000.000100', text: aLine } }),
      Result.succeed({ body: { channel: 'C0SUPPORT', ts: working, text: aLine } }),
    ]);
  });

  it('shows a line to the person alone, reads the thread and reads the person, each from the places of the message', () => {
    expect([
      renderedFor(inAThread, chat?.ephemeral?.with),
      renderedFor(inAThread, chat?.thread.with),
      renderedFor(mentioned, chat?.thread.with),
      renderedFor(mentioned, chat?.sender.with),
    ]).toEqual([
      Result.succeed({
        body: { channel: 'C0SUPPORT', user: 'U0PERSON', thread_ts: '1700000000.000100', text: aLine },
      }),
      Result.succeed({ channel: 'C0SUPPORT', ts: '1700000000.000100' }),
      Result.succeed({ channel: 'C0SUPPORT', ts: '1700000000.000200' }),
      Result.succeed({ user: 'U0PERSON' }),
    ]);
  });
});
