import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { eventDestinationOf } from '../reading/provider-list.ts';
import { providersShippedRoots, readProviders } from '../reading/shipped-providers.ts';
import {
  aClickOverASocket,
  firstDestination as destination,
  ofTheApp,
  overASocket,
  sentBy,
  without,
} from '../testing/event-destinations.ts';
import { arrivalReadingOf } from './arrival-readings.ts';

type Fields = Readonly<Record<string, Schema.Json>>;

const inAHeader = { scheme: 'bearer', secret: 'app', token: '$request.header.X-Chat-Token' };

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const click = `${destination}/filter/click`;

type Declared = Readonly<{ filter: object }> & Readonly<Record<string, unknown>>;

function carryingAClick(declared: Declared, written: Readonly<Record<string, unknown>> = aClickOverASocket) {
  return { ...declared, filter: { ...declared.filter, click: written } };
}

const clickingOverASocket = carryingAClick(overASocket);

const notProven: readonly (readonly [string, Readonly<Record<string, unknown>>])[] = [
  ['a socket that names no account', without(clickingOverASocket, 'connection')],
  ['a webhook whose secret is a header', carryingAClick({ ...ofTheApp, verify: inAHeader })],
];

describe('a destination whose deliveries carry a click, which is proven and names the account', () => {
  it('is a socket the runtime opened itself', () => {
    expect(sentBy(clickingOverASocket)).toEqual([]);
  });

  it.each(notProven)('is not %s', (_: string, declared: Readonly<Record<string, unknown>>) => {
    expect(sentBy(declared).filter(([where]) => where === click)).toEqual([[click, expect.any(String)]]);
  });

  it('is read from the payload alone, in every place it names', () => {
    const elsewhere = { ...aClickOverASocket, sender: '$message.header#/user', id: '$request.body#/id', when: {} };

    expect(sentBy(carryingAClick(overASocket, elsewhere)).map(([where]) => where)).toEqual([
      `${click}/when`,
      `${click}/sender`,
      `${click}/id`,
    ]);
  });
});

const overSlacksSocket = eventDestinationOf(shipped, 'slack-bot', 'websocket');

function readOverSlacksSocket(payload: Fields) {
  return overSlacksSocket === undefined
    ? undefined
    : arrivalReadingOf(overSlacksSocket, { transport: 'message', payload });
}

function aClick(actions: readonly Fields[], left?: string): Fields {
  const payload: Readonly<Record<string, Schema.Json>> = {
    type: 'block_actions',
    team: { id: 'T0WORKSPACE' },
    user: { id: 'U0PERSON' },
    channel: { id: 'C0APPROVALS' },
    container: { message_ts: '1.1' },
    actions: [...actions],
  };
  const kept = Object.fromEntries(
    Object.keys(payload)
      .filter((key) => key !== left)
      .map((key) => [key, payload[key] ?? null]),
  );
  return { envelope_id: 'dbdd0ef3-1543-4f94-bfb4-133d0e6c1545', type: 'interactive', payload: kept };
}

const approve = { action_id: 'auto-answer:1a2b', action_ts: '1699.5' };

const clicked = {
  wake: {
    conversation: 'C0APPROVALS',
    click: {
      account: 'T0WORKSPACE',
      id: '1699.5',
      sender: 'U0PERSON',
      to: '1.1',
      action: 'auto-answer:1a2b',
      time: '1699.5',
    },
  },
  connection: { account: 'T0WORKSPACE' },
};

describe('the clicks of Slack’s Socket Mode, as the shipped slack-bot reads them', () => {
  it('carry a click on a message the app sent, with the account it happened in', () => {
    expect(readOverSlacksSocket(aClick([approve]))).toEqual(clicked);
  });

  it.each([
    ['no button', aClick([])],
    ['a button with no id', aClick([{ action_ts: '1699.5' }])],
    ['a click with no user', aClick([approve], 'user')],
    ['a click with no channel', aClick([approve], 'channel')],
    ['a click with no message', aClick([approve], 'container')],
    ['a click with no identity', aClick([{ action_id: 'auto-answer:1a2b' }])],
  ])('carry no click for %s, and still name the account', (_, payload) => {
    expect(readOverSlacksSocket(payload)?.wake?.click).toBeUndefined();
  });

  it('carry no click for another kind of interaction', () => {
    const shortcut = { ...aClick([approve]), payload: { type: 'view_submission', team: { id: 'T0WORKSPACE' } } };

    expect(readOverSlacksSocket(shortcut)?.wake).toBeUndefined();
  });
});
