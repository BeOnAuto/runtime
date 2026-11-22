import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  arrivalReadingOf,
  eventDestinationOf,
  providerNamed,
  providersShippedRoots,
  readProviders,
  type ArrivalReading,
} from '../index.ts';

type Fields = Readonly<Record<string, Schema.Json>>;

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const overSlacksSocket = eventDestinationOf(shipped, 'slack-bot', 'websocket');

const aPersonsMessage = {
  type: 'message',
  channel: 'C0SUPPORT',
  channel_type: 'channel',
  user: 'U0PERSON',
  text: 'The build is red',
  ts: '1763629200.000100',
};

function slacksEventOf(event: Fields): ArrivalReading['event'] {
  const payload = {
    team_id: 'T0WORKSPACE',
    api_app_id: 'A0APP',
    type: 'event_callback',
    event: { ...aPersonsMessage, ...event },
  };
  const envelope = { envelope_id: 'dbdd0ef3-1543-4f94-bfb4-133d0e6c1545', type: 'events_api', payload };
  return overSlacksSocket === undefined
    ? undefined
    : arrivalReadingOf(overSlacksSocket, { transport: 'message', payload: envelope }).event;
}

const inTheThread = { thread_ts: '1763629100.000200' };

describe('a message Slack’s Socket Mode sends, as the shipped slack-bot maps it', () => {
  it('is the event that a message is posted, in a channel or a private channel, as a reply in a thread or not', () => {
    expect(slacksEventOf({})).toEqual({
      type: 'com.slack.message',
      id: 'C0SUPPORT/1763629200.000100',
      time: '2025-11-20T09:00:00.000100Z',
      subject: 'C0SUPPORT',
      data: { text: 'The build is red', user: 'U0PERSON', channel: 'C0SUPPORT', ts: '1763629200.000100' },
    });
    const postedToo: readonly Fields[] = [
      { channel_type: 'group' },
      inTheThread,
      { subtype: 'thread_broadcast', ...inTheThread },
      { subtype: 'file_share' },
      { subtype: 'me_message' },
    ];

    expect(postedToo.map((event) => slacksEventOf(event)?.type)).toEqual(postedToo.map(() => 'com.slack.message'));
  });

  it('is marked automatic where an app posted it, as a current app or as a classic integration', () => {
    expect([
      slacksEventOf({ bot_id: 'B0APP' })?.automatic,
      slacksEventOf({ subtype: 'bot_message', bot_id: 'B0APP' })?.automatic,
      slacksEventOf({})?.automatic,
    ]).toEqual([true, true, undefined]);
  });

  it('is none for a notice, an edit or a deletion, a direct message, or another kind of event', () => {
    const passedOver: readonly Fields[] = [
      { subtype: 'channel_join' },
      { subtype: 'channel_topic', topic: 'Builds' },
      { subtype: 'message_changed', hidden: true },
      { subtype: 'message_deleted', hidden: true },
      { channel_type: 'im' },
      { channel_type: 'mpim' },
      { type: 'reaction_added' },
    ];

    expect(passedOver.filter((event) => slacksEventOf(event) !== undefined)).toEqual([]);
  });
});

describe('the account that did what a message Slack’s Socket Mode sends reports', () => {
  it('is the bot its bot_id names, by the id that auth.test answers for the connection, and no account otherwise', () => {
    const slackBot = Result.getOrThrow(providerNamed(shipped, 'slack-bot'));

    expect([
      slacksEventOf({ bot_id: 'B0APP' })?.actor,
      slacksEventOf({ subtype: 'bot_message', bot_id: 'B0APP' })?.actor,
      slacksEventOf({})?.actor,
    ]).toEqual(['B0APP', 'B0APP', undefined]);
    expect(slackBot.entry.events?.identity).toEqual({ tool: 'auth_test', identified: { id: '/bot_id' } });
  });
});
