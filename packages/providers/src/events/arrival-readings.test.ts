import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { eventDestinationOf } from '../reading/provider-list.ts';
import { providersShippedRoots, readProviders } from '../reading/shipped-providers.ts';
import {
  asSlackSends,
  carrying,
  inHeadersAndTheQuery,
  ofEachSubscription,
  ofTheApp,
  overASocket,
  trackerOverASocket,
} from '../testing/event-destinations.ts';
import { providersOf } from '../testing/fixture-providers.ts';
import { arrivalReadingOf, type ArrivalReading } from './arrival-readings.ts';
import type { Arrival } from './arrival-values.ts';
import type { Destination } from './destination-fields.ts';

type Fields = Readonly<Record<string, Schema.Json>>;

interface RequestParts {
  readonly headers?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: Schema.Json;
}

function aRequest(parts: RequestParts): Arrival {
  return { transport: 'request', headers: {}, query: {}, ...parts };
}

type Reader = (arrival: Arrival) => ArrivalReading | undefined;

function readerOf(declared: object, type: 'webhook' | 'websocket' = 'webhook'): Reader {
  const entry = { ...trackerOverASocket, events: { destinations: [declared] } };
  const destination = eventDestinationOf(providersOf(entry), 'tracker', type);
  return (arrival) => (destination === undefined ? undefined : arrivalReadingOf(destination, arrival));
}

const readByTheTracker = readerOf(inHeadersAndTheQuery);

const readAsSlackSends = readerOf(asSlackSends);

function aDelivery(headers: Readonly<Record<string, string>>, body: Fields = {}): Arrival {
  return aRequest({ headers: { 'x-tracker-event': 'comment', 'x-tracker-hook': '42', ...headers }, body });
}

const aPersonsMessage: Fields = { type: 'message', channel: 'C0APPROVALS', user: 'U0PERSON', ts: '1.2' };

function anEvent(event: Fields, ...left: readonly string[]): Arrival {
  const kept = Object.entries({ ...aPersonsMessage, ...event }).filter(
    ([key]: readonly [string, Schema.Json]) => !left.includes(key),
  );
  return aRequest({ body: { type: 'event_callback', team_id: 'T0WORKSPACE', event: Object.fromEntries(kept) } });
}

function aReplyIn(event: Fields, ...left: readonly string[]): Arrival {
  return anEvent({ thread_ts: '1.1', text: 'approve', ...event }, ...left);
}

const theWorkspace = { connection: { account: 'T0WORKSPACE' } };

const reply = { account: 'T0WORKSPACE', id: '1.2', sender: 'U0PERSON', text: 'approve', to: '1.1', time: '1.2' };

function woken(carried?: object): object {
  const wake =
    carried === undefined ? { conversation: 'C0APPROVALS' } : { conversation: 'C0APPROVALS', reply: carried };
  return { wake, ...theWorkspace };
}

function timeAt(time?: string): string | number | undefined {
  const declared = {
    id: '$request.body#/event/ts',
    sender: '$request.body#/event/user',
    text: '$request.body#/event/text',
  };
  const replying = { ...declared, to: '$request.body#/event/thread_ts', ...(time === undefined ? {} : { time }) };
  const event = { ...aPersonsMessage, thread_ts: '1.1', text: 'approve', edited: true };
  const body = { type: 'event_callback', team_id: 'T0WORKSPACE', event_time: 1_700_000_000, event };
  return readerOf(carrying(ofTheApp, replying))(aRequest({ body }))?.wake?.reply?.time;
}

function aMessage(payload: Fields): Arrival {
  return { transport: 'message', payload: { type: 'events_api', payload } };
}

describe('when a destination declares', () => {
  it('holds where every expression’s value is text equal to one of its values', () => {
    expect([
      readByTheTracker(aDelivery({ 'x-tracker-event': 'review' })),
      readByTheTracker(aDelivery({ 'x-tracker-event': 'push' })),
      readAsSlackSends(anEvent({ type: 'app_mention' })),
      readAsSlackSends(aRequest({ body: { type: ['event_callback'], event: aPersonsMessage } })),
      readAsSlackSends(aRequest({ body: 'a body that is no object' })),
    ]).toEqual([{ wake: { subscription: '42' } }, {}, theWorkspace, {}, {}]);
  });

  it('holds where an expression holds nothing, missing or null, and its values name null', () => {
    const subtypes = { '$request.body#/event/subtype': [null, 'thread_broadcast'] };
    const read = readerOf({
      ...ofTheApp,
      filter: { ...ofTheApp.filter, when: { ...ofTheApp.filter.when, ...subtypes } },
    });

    expect([
      read(anEvent({})),
      read(anEvent({ subtype: null })),
      read(anEvent({ subtype: 'thread_broadcast' })),
      read(anEvent({ subtype: 'channel_join' })),
    ]).toEqual([woken(), woken(), woken(), theWorkspace]);
  });

  it('holds nothing where it names no expression', () => {
    const declared: Destination = {
      type: 'webhook',
      per: 'app',
      handshake: { when: {}, challenge: '$request.body#/challenge', signed: true },
      filter: { when: {} },
    };

    expect(arrivalReadingOf(declared, aRequest({ body: { challenge: 'abc' } }))).toEqual({});
  });
});

describe('the wake an arrival is', () => {
  it('names the subscription and the conversation it is for, each only as text that is not empty', () => {
    expect([
      readByTheTracker(aDelivery({}, { comment: { thread: 'T-7' } })),
      readByTheTracker(aDelivery({ 'x-tracker-hook': '' }, { comment: { thread: 7 } })),
      readAsSlackSends(anEvent({})),
      readAsSlackSends(anEvent({ channel: 7 })),
      readAsSlackSends(anEvent({ channel: '' })),
      readAsSlackSends(anEvent({}, 'channel')),
    ]).toEqual([
      { wake: { subscription: '42', conversation: 'T-7' } },
      { wake: {} },
      woken(),
      { wake: {}, ...theWorkspace },
      { wake: {}, ...theWorkspace },
      { wake: {}, ...theWorkspace },
    ]);
  });

  it('still wakes where it names neither, so Auto reads what waits through the connection', () => {
    const declaringNeither = { ...ofEachSubscription, filter: { when: ofEachSubscription.filter.when } };

    expect([
      readByTheTracker(aRequest({ headers: { 'x-tracker-event': 'comment' } })),
      readerOf(declaringNeither)(aDelivery({}, { comment: { thread: 'T-7' } })),
    ]).toEqual([{ wake: {} }, { wake: {} }]);
  });

  it('is none where automatic holds anything but null, an app having posted the message', () => {
    expect([
      readByTheTracker(aDelivery({}, { sender: { app: 'A0BOT' } })),
      readByTheTracker(aDelivery({}, { sender: { app: false } })),
      readByTheTracker(aDelivery({}, { sender: { app: null } })),
      readAsSlackSends(anEvent({ bot_id: 'B0APP' })),
    ]).toEqual([{}, {}, { wake: { subscription: '42' } }, theWorkspace]);
  });
});

describe('the reply a delivery carries', () => {
  it('is a person’s message that answers one, with the account it happened in and when, its words empty or not', () => {
    expect([
      readAsSlackSends(aReplyIn({})),
      readAsSlackSends(aReplyIn({ subtype: 'thread_broadcast' })),
      readAsSlackSends(aReplyIn({ text: '' })),
    ]).toEqual([woken(reply), woken(reply), woken({ ...reply, text: '' })]);
  });

  it('is none where changed holds anything, an edit, a deletion or a notice, which still wakes', () => {
    expect([
      readAsSlackSends(aReplyIn({ subtype: 'message_changed', hidden: true })),
      readAsSlackSends(aReplyIn({ subtype: 'message_deleted', hidden: true })),
      readAsSlackSends(aReplyIn({ hidden: true }, 'user')),
    ]).toEqual([woken(), woken(), woken()]);
  });

  it('carries its time where it is text or a number, and none where it is neither, is missing or is not declared', () => {
    expect([
      timeAt('$request.body#/event_time'),
      timeAt('$request.body#/event/ts'),
      timeAt('$request.body#/event/edited'),
      timeAt('$request.body#/event/written_at'),
      timeAt(),
    ]).toEqual([1_700_000_000, '1.2', undefined, undefined, undefined]);
  });
});

describe('the reply a delivery does not carry', () => {
  it('is one without the message it answers, a writer, its words, the account, or a conversation its wake names', () => {
    const unowned = aRequest({ body: { type: 'event_callback', event: { ...aPersonsMessage, thread_ts: '1.1' } } });

    expect([
      readAsSlackSends(aReplyIn({}, 'thread_ts')),
      readAsSlackSends(aReplyIn({ user: '' })),
      readAsSlackSends(aReplyIn({}, 'text')),
      readAsSlackSends(aReplyIn({ text: 7 })),
      readAsSlackSends(unowned),
      readAsSlackSends(aReplyIn({}, 'channel')),
    ]).toEqual([
      woken(),
      woken(),
      woken(),
      woken(),
      { wake: { conversation: 'C0APPROVALS' } },
      { wake: {}, ...theWorkspace },
    ]);
  });

  it('is one where the wake is none, or where the filter declares no reply', () => {
    expect([
      readAsSlackSends(aReplyIn({ bot_id: 'B0APP' })),
      readAsSlackSends(aRequest({ body: { type: 'url_verification', challenge: '3eZbrw1a' } })),
      readerOf(ofTheApp)(aReplyIn({})),
    ]).toEqual([theWorkspace, { handshake: { challenge: '3eZbrw1a' } }, woken()]);
  });
});

describe('the connection an arrival is for', () => {
  it('names the account and the user, each only as text that is not empty', () => {
    const event = { channel: 'C0APPROVALS', user: 'U0PERSON' };
    const readOverASocket = readerOf(overASocket, 'websocket');

    expect([
      readOverASocket(aMessage({ team_id: 'T0WORKSPACE', event })),
      readOverASocket(aMessage({ team_id: '', event })),
      readOverASocket(aMessage({ team_id: 7, event: { channel: 'C0APPROVALS' } })),
    ]).toEqual([
      { wake: { conversation: 'C0APPROVALS' }, connection: { account: 'T0WORKSPACE', user: 'U0PERSON' } },
      { wake: { conversation: 'C0APPROVALS' }, connection: { user: 'U0PERSON' } },
      { wake: { conversation: 'C0APPROVALS' } },
    ]);
  });

  it('is read whether or not the arrival wakes', () => {
    expect(readAsSlackSends(anEvent({ type: 'reaction_added' }))).toEqual(theWorkspace);
  });
});

describe('the handshake an arrival is', () => {
  it('is an arrival its when names, with the challenge where it is text that is not empty', () => {
    expect([
      readByTheTracker(aRequest({ query: { 'hub.mode': 'subscribe', 'hub.challenge': 'c0ffee' } })),
      readByTheTracker(aRequest({ query: { 'hub.mode': 'unsubscribe', 'hub.challenge': '' } })),
      readByTheTracker(aRequest({ query: { 'hub.mode': 'subscribe' } })),
      readAsSlackSends(aRequest({ body: { type: 'url_verification', challenge: 7 } })),
    ]).toEqual([{ handshake: { challenge: 'c0ffee' } }, { handshake: {} }, { handshake: {} }, { handshake: {} }]);
  });

  it('is none where its when does not hold, or where the destination declares none', () => {
    const asked = { 'hub.mode': 'subscribe', 'hub.challenge': 'c0ffee' };

    expect([
      readByTheTracker(aRequest({ query: { ...asked, 'hub.mode': 'denied' } })),
      readerOf(ofEachSubscription)(aRequest({ query: asked })),
    ]).toEqual([{}, {}]);
  });

  it('stands beside the other parts an arrival is, each read apart', () => {
    const headers = { 'X-Tracker-Event': 'comment', 'X-Tracker-Hook': '42' };
    const query = { 'hub.mode': 'subscribe', 'hub.challenge': 'c0ffee' };

    expect(readByTheTracker(aRequest({ headers, query }))).toEqual({
      handshake: { challenge: 'c0ffee' },
      wake: { subscription: '42' },
    });
  });
});

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

function anEnvelope(event: Fields): Fields {
  const payload = { team_id: 'T0WORKSPACE', api_app_id: 'A0APP', type: 'event_callback', event };
  return { envelope_id: 'dbdd0ef3-1543-4f94-bfb4-133d0e6c1545', type: 'events_api', payload };
}

describe('the messages of Slack’s Socket Mode, as the shipped slack-bot reads them', () => {
  const overSlacksSocket = eventDestinationOf(shipped, 'slack-bot', 'websocket');

  function readOverSlacksSocket(payload: Fields): ArrivalReading | undefined {
    return overSlacksSocket === undefined
      ? undefined
      : arrivalReadingOf(overSlacksSocket, { transport: 'message', payload });
  }

  it('wake for a person’s message in a conversation, and for nothing else the socket sends', () => {
    expect([
      readOverSlacksSocket(anEnvelope({ ...aPersonsMessage, text: 'approve' })),
      readOverSlacksSocket(anEnvelope({ ...aPersonsMessage, bot_id: 'B0APP' })),
      readOverSlacksSocket(anEnvelope({ type: 'reaction_added', user: 'U0PERSON' })),
      readOverSlacksSocket({ type: 'hello', num_connections: 1 }),
      readOverSlacksSocket({ type: 'disconnect', reason: 'refresh_requested' }),
    ]).toEqual([woken(), theWorkspace, theWorkspace, {}, {}]);
  });
});
