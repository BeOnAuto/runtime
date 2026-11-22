import { cardMoved, overTheBoardsSocket, tracker } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import {
  archived,
  autoCloud,
  boardsSentBy,
  bySubscription,
  byTheApp,
  heldRefused,
  heldUnrefused,
  noneHeld,
  theServerWithAnAddress,
  theServerWithNoAddress,
} from '../testing/boards-reported.ts';
import { hearingOf, nothingReceived, type Hearing } from './connection-hearing.ts';

const subscribedOrOverASocket = boardsSentBy(bySubscription, overTheBoardsSocket);

const routedOrOverASocket = boardsSentBy(byTheApp, overTheBoardsSocket);

const overASocketAlone = boardsSentBy(overTheBoardsSocket);

const subscribedAlone = boardsSentBy(bySubscription);

function shownAs(hearing: Hearing): string {
  if (hearing.kind === 'heard') {
    const { type, per } = hearing.destination;
    return `heard ${type}${per === undefined ? '' : ` per ${per}`}`;
  }
  return hearing.kind === 'lacking' ? `lacking ${hearing.label}` : 'not heard';
}

const rows = [
  {
    is: 'a subscription first, where an address is set',
    entry: subscribedOrOverASocket,
    received: theServerWithAnAddress,
    held: heldUnrefused,
    answer: 'heard webhook per subscription',
  },
  {
    is: 'a subscription first, though the app credential is missing',
    entry: subscribedOrOverASocket,
    received: theServerWithAnAddress,
    held: noneHeld,
    answer: 'heard webhook per subscription',
  },
  {
    is: 'the socket, where no address is set',
    entry: subscribedOrOverASocket,
    received: theServerWithNoAddress,
    held: heldUnrefused,
    answer: 'heard websocket',
  },
  {
    is: 'lacking the app credential the service refused',
    entry: subscribedOrOverASocket,
    received: theServerWithNoAddress,
    held: heldRefused,
    answer: 'lacking Chat app-level token',
  },
  {
    is: 'lacking the app credential never given',
    entry: subscribedOrOverASocket,
    received: theServerWithNoAddress,
    held: noneHeld,
    answer: 'lacking Chat app-level token',
  },
  {
    is: 'the app’s one address, on a runtime that routes it',
    entry: routedOrOverASocket,
    received: autoCloud,
    held: noneHeld,
    answer: 'heard webhook per app',
  },
  {
    is: 'the socket, on a runtime that routes no app’s address',
    entry: routedOrOverASocket,
    received: theServerWithNoAddress,
    held: heldUnrefused,
    answer: 'heard websocket',
  },
  {
    is: 'lacking, where an address is set but nothing routes the app’s',
    entry: routedOrOverASocket,
    received: theServerWithAnAddress,
    held: heldRefused,
    answer: 'lacking Chat app-level token',
  },
  {
    is: 'nothing, over a socket a runtime does not open',
    entry: overASocketAlone,
    received: autoCloud,
    held: heldUnrefused,
    answer: 'not heard',
  },
  {
    is: 'nothing, through a subscription a runtime receives nothing for',
    entry: subscribedAlone,
    received: theServerWithNoAddress,
    held: heldUnrefused,
    answer: 'not heard',
  },
  {
    is: 'nothing, on a runtime that receives nothing',
    entry: subscribedOrOverASocket,
    received: nothingReceived,
    held: heldUnrefused,
    answer: 'not heard',
  },
] as const;

describe('whether this runtime hears an event a connection reports', () => {
  it.each(rows)('is $is', ({ entry, received, held, answer }) => {
    expect(shownAs(hearingOf({ app_credentials: held }, entry, received, cardMoved.type))).toBe(answer);
  });

  it('is nothing for a type no destination maps, and for an entry that sends nothing', () => {
    const answers = [
      hearingOf({ app_credentials: heldUnrefused }, subscribedOrOverASocket, theServerWithAnAddress, archived.type),
      hearingOf({ app_credentials: heldUnrefused }, tracker, theServerWithAnAddress, cardMoved.type),
    ];

    expect(answers.map((answer) => shownAs(answer))).toEqual(['not heard', 'not heard']);
  });
});
